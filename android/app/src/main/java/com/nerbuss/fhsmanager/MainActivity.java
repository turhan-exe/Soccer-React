package com.nerbuss.fhsmanager;

import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.nerbuss.fhsmanager.ads.RewardedAdsPlugin;
import com.nerbuss.fhsmanager.auth.SecureCredentialsPlugin;
import com.nerbuss.fhsmanager.billing.PlayBillingPlugin;
import com.nerbuss.fhsmanager.ui.UiStatePlugin;
import com.nerbuss.fhsmanager.update.PlayUpdatePlugin;
import com.nerbuss.fhsmanager.unity.UnityBridgeState;
import com.nerbuss.fhsmanager.unity.UnityMatchPlugin;

public class MainActivity extends BridgeActivity {
  private static final int APP_BACKGROUND_COLOR = Color.parseColor("#020617");
  private static final String STARTUP_TAG = "FHSStartup";
  private static final String EXTRA_FORCE_SHELL_RETURN = "unity_force_shell_return";
  private static final String SHELL_RETURN_EVENT =
      "window.dispatchEvent(new CustomEvent('nativeUnityShellReturn', { detail: { reason: 'unity-intent' } }));";
  private static final long SNAPSHOT_GUARD_INITIAL_HIDE_DELAY_MS = 4500L;
  private static final long SNAPSHOT_GUARD_READY_HIDE_DELAY_MS = 150L;
  private static final long SNAPSHOT_GUARD_RESUME_HIDE_DELAY_MS = 1000L;
  private static final long SNAPSHOT_GUARD_WEBVIEW_FADE_DELAY_MS = 80L;
  private static final long SNAPSHOT_GUARD_WEBVIEW_FADE_DURATION_MS = 160L;
  private final Runnable requestSnapshotGuardHideRunnable = this::requestSnapshotGuardHide;
  private View snapshotGuardView;
  private long snapshotGuardVisualStateRequestId = 0L;
  private final long startupStartedAtMs = SystemClock.elapsedRealtime();
  private boolean bootVisualReadyReceived = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    logStartup("activity_on_create_start");
    registerPlugin(RewardedAdsPlugin.class);
    registerPlugin(SecureCredentialsPlugin.class);
    registerPlugin(PlayBillingPlugin.class);
    registerPlugin(PlayUpdatePlugin.class);
    registerPlugin(UiStatePlugin.class);
    registerPlugin(UnityMatchPlugin.class);
    super.onCreate(savedInstanceState);
    logStartup("activity_super_on_create_complete");
    installSnapshotGuard();
    showSnapshotGuard();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      setRecentsScreenshotEnabled(false);
    }
    hardenWebViewNetworkPolicy();
    enableImmersiveMode();
    dispatchPendingUnityShellReturn(getIntent());
    dispatchPendingUnityShellReturnFromBridgeState();
    logStartup("activity_on_create_complete");
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
    if (!bootVisualReadyReceived) {
      showSnapshotGuard();
      scheduleSnapshotGuardHide();
    }
    dispatchPendingUnityShellReturn(getIntent());
    dispatchPendingUnityShellReturnFromBridgeState();
  }

  @Override
  public void onPause() {
    if (!bootVisualReadyReceived) {
      showSnapshotGuard();
    }
    super.onPause();
  }

  @Override
  public void onDestroy() {
    clearSnapshotGuardCallbacks();
    super.onDestroy();
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

  private void hardenWebViewNetworkPolicy() {
    if (getBridge() == null || getBridge().getWebView() == null) {
      return;
    }

    WebSettings settings = getBridge().getWebView().getSettings();
    if (settings == null) {
      return;
    }

    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    getBridge().getWebView().setBackgroundColor(APP_BACKGROUND_COLOR);
  }

  private void installSnapshotGuard() {
    if (snapshotGuardView != null) {
      return;
    }

    final FrameLayout root = findViewById(android.R.id.content);
    if (root == null) {
      return;
    }

    final View overlay = new View(this);
    overlay.setBackgroundColor(APP_BACKGROUND_COLOR);
    overlay.setVisibility(View.VISIBLE);
    overlay.setClickable(false);
    overlay.setFocusable(false);
    overlay.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

    root.addView(
        overlay,
        new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));
    snapshotGuardView = overlay;
    logStartup("snapshot_guard_installed");
  }

  private void showSnapshotGuard() {
    if (bootVisualReadyReceived && !isSnapshotGuardVisible()) {
      return;
    }

    clearSnapshotGuardCallbacks();
    snapshotGuardVisualStateRequestId++;
    prepareWebViewForGuard();
    if (snapshotGuardView != null) {
      snapshotGuardView.setVisibility(View.VISIBLE);
      snapshotGuardView.bringToFront();
    }
  }

  private void scheduleSnapshotGuardHide() {
    if (snapshotGuardView == null) {
      return;
    }

    snapshotGuardView.removeCallbacks(requestSnapshotGuardHideRunnable);
    final long delayMs =
        bootVisualReadyReceived
            ? SNAPSHOT_GUARD_RESUME_HIDE_DELAY_MS
            : SNAPSHOT_GUARD_INITIAL_HIDE_DELAY_MS;
    snapshotGuardView.postDelayed(requestSnapshotGuardHideRunnable, delayMs);
  }

  public void markBootVisualReady() {
    runOnUiThread(
        () -> {
          logStartup("mark_boot_visual_ready");
          if (bootVisualReadyReceived && !isSnapshotGuardVisible()) {
            return;
          }

          bootVisualReadyReceived = true;
          clearSnapshotGuardCallbacks();
          if (!isSnapshotGuardVisible()) {
            return;
          }

          snapshotGuardView.postDelayed(
              requestSnapshotGuardHideRunnable, SNAPSHOT_GUARD_READY_HIDE_DELAY_MS);
        });
  }

  private void requestSnapshotGuardHide() {
    if (!isSnapshotGuardVisible()) {
      return;
    }

    logStartup("snapshot_guard_hide_requested");
    final WebView webView = getBridgeWebView();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || webView == null) {
      revealWebView(snapshotGuardVisualStateRequestId);
      return;
    }

    final long requestId = ++snapshotGuardVisualStateRequestId;
    webView.postVisualStateCallback(
        requestId,
        new WebView.VisualStateCallback() {
          @Override
          public void onComplete(long id) {
            if (id != requestId) {
              return;
            }

            runOnUiThread(
                () -> {
                  if (id != snapshotGuardVisualStateRequestId) {
                    return;
                  }

                  logStartup("webview_visual_state_complete");
                  revealWebView(id);
                });
          }
        });
  }

  private WebView getBridgeWebView() {
    if (getBridge() == null) {
      return null;
    }

    return getBridge().getWebView();
  }

  private void prepareWebViewForGuard() {
    final WebView webView = getBridgeWebView();
    if (webView == null) {
      return;
    }

    webView.animate().cancel();
    webView.setAlpha(0f);
  }

  private void revealWebView(long requestId) {
    final WebView webView = getBridgeWebView();
    if (webView == null) {
      hideSnapshotGuard();
      return;
    }

    webView.animate().cancel();
    webView.setAlpha(0f);
    webView.postDelayed(
        () ->
            runOnUiThread(
                () -> {
                  if (requestId != snapshotGuardVisualStateRequestId) {
                    return;
                  }

                  hideSnapshotGuard();
                  logStartup("webview_reveal_started");
                  webView.animate().alpha(1f).setDuration(SNAPSHOT_GUARD_WEBVIEW_FADE_DURATION_MS).start();
                }),
        SNAPSHOT_GUARD_WEBVIEW_FADE_DELAY_MS);
  }

  private void hideSnapshotGuard() {
    if (snapshotGuardView != null) {
      snapshotGuardView.setVisibility(View.GONE);
      logStartup("snapshot_guard_hidden");
    }
  }

  private void logStartup(String label) {
    if (!BuildConfig.DEBUG) {
      return;
    }

    Log.i(
        STARTUP_TAG,
        label + " +" + (SystemClock.elapsedRealtime() - startupStartedAtMs) + "ms");
  }

  private boolean isSnapshotGuardVisible() {
    return snapshotGuardView != null && snapshotGuardView.getVisibility() == View.VISIBLE;
  }

  private void clearSnapshotGuardCallbacks() {
    if (snapshotGuardView != null) {
      snapshotGuardView.removeCallbacks(requestSnapshotGuardHideRunnable);
    }
  }
}
