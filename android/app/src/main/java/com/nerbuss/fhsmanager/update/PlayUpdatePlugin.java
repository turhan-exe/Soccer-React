package com.nerbuss.fhsmanager.update;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Task;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "PlayUpdate")
public class PlayUpdatePlugin extends Plugin {
  private static final String TAG = "PlayUpdatePlugin";
  private static final int UPDATE_REQUEST_CODE = 17261;

  private AppUpdateManager appUpdateManager;

  @Override
  public void load() {
    super.load();
    appUpdateManager = AppUpdateManagerFactory.create(getContext());
  }

  @Override
  protected void handleOnResume() {
    super.handleOnResume();
    queryUpdateInfo(
        updateInfo -> notifyListeners("playUpdateStateChanged", toState(updateInfo, "play"), true),
        error ->
            notifyListeners(
                "playUpdateStateChanged", buildFallbackState(messageOf(error)), true));
  }

  @Override
  protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
    super.handleOnActivityResult(requestCode, resultCode, data);
    if (requestCode != UPDATE_REQUEST_CODE) {
      return;
    }

    JSObject result = new JSObject();
    result.put("requestCode", requestCode);
    result.put("resultCode", resultCode);
    notifyListeners("playUpdateFlowResult", result, true);
  }

  @PluginMethod
  public void getUpdateState(PluginCall call) {
    queryUpdateInfo(
        updateInfo -> call.resolve(toState(updateInfo, "play")),
        error -> call.resolve(buildFallbackState(messageOf(error))));
  }

  @PluginMethod
  public void startImmediateUpdate(PluginCall call) {
    if (getActivity() == null || appUpdateManager == null) {
      call.resolve(buildStartResult(false, "activity_unavailable"));
      return;
    }

    queryUpdateInfo(
        updateInfo -> {
          boolean inProgress =
              updateInfo.updateAvailability()
                  == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
          boolean immediateAllowed = isImmediateAllowed(updateInfo);
          boolean updateAvailable =
              updateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE || inProgress;

          if (!updateAvailable) {
            call.resolve(buildStartResult(false, "no_update_available"));
            return;
          }

          if (!inProgress && !immediateAllowed) {
            call.resolve(buildStartResult(false, "immediate_update_not_allowed"));
            return;
          }

          try {
            boolean started =
                appUpdateManager.startUpdateFlowForResult(
                    updateInfo,
                    getActivity(),
                    AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                    UPDATE_REQUEST_CODE);
            call.resolve(buildStartResult(started, started ? null : "start_update_flow_failed"));
          } catch (Exception error) {
            Log.w(TAG, "Unable to start immediate update", error);
            call.resolve(buildStartResult(false, error.getMessage()));
          }
        },
        error -> call.resolve(buildStartResult(false, messageOf(error))));
  }

  @PluginMethod
  public void openStoreListing(PluginCall call) {
    String packageName = getContext().getPackageName();
    Intent marketIntent =
        new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageName));
    marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

    try {
      getContext().startActivity(marketIntent);
      call.resolve();
      return;
    } catch (ActivityNotFoundException error) {
      Log.w(TAG, "Play Store intent unavailable, falling back to web listing", error);
    }

    Intent webIntent =
        new Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://play.google.com/store/apps/details?id=" + packageName));
    webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

    try {
      getContext().startActivity(webIntent);
      call.resolve();
    } catch (Exception error) {
      call.reject("unable_to_open_store_listing", error);
    }
  }

  private void queryUpdateInfo(
      com.google.android.gms.tasks.OnSuccessListener<AppUpdateInfo> onSuccess,
      com.google.android.gms.tasks.OnFailureListener onFailure) {
    if (appUpdateManager == null) {
      onFailure.onFailure(new IllegalStateException("app_update_manager_unavailable"));
      return;
    }

    Task<AppUpdateInfo> task = appUpdateManager.getAppUpdateInfo();
    task.addOnSuccessListener(onSuccess);
    task.addOnFailureListener(onFailure);
  }

  private JSObject toState(AppUpdateInfo updateInfo, String source) {
    boolean inProgress =
        updateInfo.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
    boolean updateAvailable =
        updateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE || inProgress;

    JSObject result = new JSObject();
    result.put("updateAvailable", updateAvailable);
    result.put("immediateAllowed", isImmediateAllowed(updateInfo) || inProgress);
    result.put("inProgress", inProgress);
    result.put("source", source);
    result.put("availableVersionCode", updateInfo.availableVersionCode());
    result.put("updateAvailability", updateInfo.updateAvailability());
    result.put("installStatus", updateInfo.installStatus());
    return result;
  }

  private JSObject buildFallbackState(String error) {
    JSObject result = new JSObject();
    result.put("updateAvailable", false);
    result.put("immediateAllowed", false);
    result.put("inProgress", false);
    result.put("source", "fallback");
    if (error != null && !error.trim().isEmpty()) {
      result.put("error", error);
    }
    return result;
  }

  private JSObject buildStartResult(boolean started, String error) {
    JSObject result = new JSObject();
    result.put("started", started);
    if (error != null && !error.trim().isEmpty()) {
      result.put("error", error);
    }
    return result;
  }

  private boolean isImmediateAllowed(AppUpdateInfo updateInfo) {
    try {
      return updateInfo.isUpdateTypeAllowed(
          AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build());
    } catch (Exception error) {
      Log.w(TAG, "Unable to inspect immediate update allowance", error);
      return false;
    }
  }

  private String messageOf(Exception error) {
    return error == null ? null : error.getMessage();
  }
}
