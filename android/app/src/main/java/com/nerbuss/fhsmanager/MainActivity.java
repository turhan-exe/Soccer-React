package com.nerbuss.fhsmanager;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.nerbuss.fhsmanager.unity.UnityBridgeState;
import com.nerbuss.fhsmanager.unity.UnityMatchPlugin;

public class MainActivity extends BridgeActivity {
  private static final int APP_BACKGROUND_COLOR = Color.parseColor("#020617");
  private static final String EXTRA_FORCE_SHELL_RETURN = "unity_force_shell_return";
  private static final String SHELL_RETURN_EVENT =
      "window.dispatchEvent(new CustomEvent('nativeUnityShellReturn', { detail: { reason: 'unity-intent' } }));";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(UnityMatchPlugin.class);
    super.onCreate(savedInstanceState);
    allowHttpApiRequestsFromWebView();
    enableImmersiveMode();
    dispatchPendingUnityShellReturn(getIntent());
    dispatchPendingUnityShellReturnFromBridgeState();
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    dispatchPendingUnityShellReturn(intent);
    dispatchPendingUnityShellReturnFromBridgeState();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      enableImmersiveMode();
    }
  }

  @Override
  public void onResume() {
    super.onResume();
    enableImmersiveMode();
    dispatchPendingUnityShellReturn(getIntent());
    dispatchPendingUnityShellReturnFromBridgeState();
  }

  private void dispatchPendingUnityShellReturn(Intent intent) {
    if (intent == null || !intent.getBooleanExtra(EXTRA_FORCE_SHELL_RETURN, false)) {
      return;
    }

    intent.removeExtra(EXTRA_FORCE_SHELL_RETURN);
    dispatchShellReturnEvent();
  }

  private void dispatchPendingUnityShellReturnFromBridgeState() {
    if (!UnityBridgeState.consumePendingShellReturn()) {
      return;
    }

    dispatchShellReturnEvent();
  }

  private void dispatchShellReturnEvent() {
    if (getBridge() == null || getBridge().getWebView() == null) {
      return;
    }

    getBridge()
        .getWebView()
        .post(
            () -> {
              if (getBridge() == null || getBridge().getWebView() == null) {
                return;
              }

              getBridge().getWebView().evaluateJavascript(SHELL_RETURN_EVENT, null);
            });
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

  private void allowHttpApiRequestsFromWebView() {
    if (getBridge() == null || getBridge().getWebView() == null) {
      return;
    }

    WebSettings settings = getBridge().getWebView().getSettings();
    if (settings == null) {
      return;
    }

    // Domainsiz Hetzner testinde Capacitor WebView -> http://IP:8080 çağrılarını bloklamasın.
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    getBridge().getWebView().setBackgroundColor(APP_BACKGROUND_COLOR);
  }
}
