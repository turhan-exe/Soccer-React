package com.nerbuss.fhsmanager.unity;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.annotation.Nullable;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class UnityHostActivity extends Activity {
  private static final int REQ_UNITY = 4107;
  private static final String UNITY_ACTIVITY_META = "com.nerbuss.fhsmanager.UNITY_ACTIVITY_CLASS";
  private static final int APP_BACKGROUND_COLOR = Color.parseColor("#020617");

  private boolean launchedChild;
  private boolean waitingChildResult;
  private String matchId;
  private String serverIp;
  private int serverPort;

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    enableImmersiveMode();
    UnityBridgeState.setActiveUnityHost(this);

    Intent source = getIntent();
    matchId = source != null ? source.getStringExtra(UnityBridgeState.EXTRA_MATCH_ID) : null;
    serverIp = source != null ? source.getStringExtra(UnityBridgeState.EXTRA_SERVER_IP) : null;
    serverPort = source != null ? source.getIntExtra(UnityBridgeState.EXTRA_SERVER_PORT, 0) : 0;

    UnityBridgeState.emit("ready", "Unity host activity opened.", matchId, serverIp, serverPort);
    launchUnityChildOrFail();
  }

  @Override
  protected void onResume() {
    super.onResume();
    enableImmersiveMode();

    // When Unity activity closes and this host comes back to foreground, complete flow.
    if (launchedChild && !waitingChildResult) {
      UnityBridgeState.emit("closed", "Unity activity closed.", matchId, serverIp, serverPort);
      finish();
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      enableImmersiveMode();
    }
  }

  @Override
  protected void onDestroy() {
    UnityBridgeState.clearActiveUnityHost(this);
    super.onDestroy();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != REQ_UNITY) {
      return;
    }

    waitingChildResult = false;
    UnityBridgeState.emit(
        "closed",
        "Unity activity returned. resultCode=" + resultCode,
        matchId,
        serverIp,
        serverPort);
    finish();
  }

  private void launchUnityChildOrFail() {
    String unityActivityClassName = resolveUnityActivityClassName();
    if (unityActivityClassName == null || unityActivityClassName.trim().isEmpty()) {
      UnityBridgeState.emit(
          "error",
          "UNITY_ACTIVITY_CLASS metadata missing. Unity as Library entegrasyonu eksik.",
          matchId,
          serverIp,
          serverPort);
      finish();
      return;
    }

    final Class<?> unityActivityClass;
    try {
      unityActivityClass = Class.forName(unityActivityClassName);
    } catch (ClassNotFoundException e) {
      UnityBridgeState.emit(
          "error",
          "Unity activity class not found: " + unityActivityClassName + ". unityLibrary import edilmemis olabilir.",
          matchId,
          serverIp,
          serverPort);
      finish();
      return;
    }

    try {
      Intent source = getIntent();
      Intent unityIntent = new Intent(this, unityActivityClass);
      if (source != null && source.getExtras() != null) {
        unityIntent.putExtras(source.getExtras());
      }
      waitingChildResult = true;
      launchedChild = true;
      startActivityForResult(unityIntent, REQ_UNITY);
      UnityBridgeState.emit(
          "connected",
          "Unity activity launch requested.",
          matchId,
          serverIp,
          serverPort);
    } catch (Throwable t) {
      waitingChildResult = false;
      UnityBridgeState.emit(
          "error",
          "Unity activity baslatilamadi: " + t.getClass().getSimpleName() + " " + t.getMessage(),
          matchId,
          serverIp,
          serverPort);
      finish();
    }
  }

  @Nullable
  private String resolveUnityActivityClassName() {
    try {
      ApplicationInfo ai =
          getPackageManager().getApplicationInfo(getPackageName(), PackageManager.GET_META_DATA);
      if (ai.metaData == null) {
        return "com.unity3d.player.UnityPlayerActivity";
      }

      String value = ai.metaData.getString(UNITY_ACTIVITY_META);
      if (value == null || value.trim().isEmpty()) {
        return "com.unity3d.player.UnityPlayerActivity";
      }

      return value.trim();
    } catch (Throwable ignored) {
      return "com.unity3d.player.UnityPlayerActivity";
    }
  }

  private void enableImmersiveMode() {
    final Window window = getWindow();
    if (window == null) {
      return;
    }

    WindowCompat.setDecorFitsSystemWindows(window, false);
    final View decorView = window.getDecorView();
    if (decorView == null) {
      return;
    }

    window.setStatusBarColor(Color.TRANSPARENT);
    window.setNavigationBarColor(APP_BACKGROUND_COLOR);
    decorView.setBackgroundColor(APP_BACKGROUND_COLOR);

    final WindowInsetsControllerCompat controller =
        new WindowInsetsControllerCompat(window, decorView);
    controller.setAppearanceLightStatusBars(false);
    controller.setAppearanceLightNavigationBars(false);
    controller.hide(
        WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
    controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

    decorView.setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);

    decorView.post(
        () ->
            controller.hide(
                WindowInsetsCompat.Type.statusBars()
                    | WindowInsetsCompat.Type.navigationBars()));
  }
}
