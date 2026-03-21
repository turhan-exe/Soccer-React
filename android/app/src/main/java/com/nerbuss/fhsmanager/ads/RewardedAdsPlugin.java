package com.nerbuss.fhsmanager.ads;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.text.TextUtils;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import com.google.android.ump.ConsentDebugSettings;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.FormError;
import com.google.android.ump.UserMessagingPlatform;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

@CapacitorPlugin(name = "RewardedAds")
public class RewardedAdsPlugin extends Plugin {
  private static final String TAG = "RewardedAdsPlugin";
  private static final String META_APP_ID = "com.google.android.gms.ads.APPLICATION_ID";

  private ConsentInformation consentInformation;
  private RewardedAd rewardedAd;
  private final List<PendingReadyRequest> pendingReadyRequests = new ArrayList<>();
  private final List<PendingReadyRequest> pendingAdRequests = new ArrayList<>();

  private boolean initInFlight = false;
  private boolean sdkReady = false;
  private boolean mobileAdsInitialized = false;
  private boolean adLoadInFlight = false;

  private String pendingShowCallId;
  private boolean rewardEarnedForCurrentAd = false;

  @Override
  public void load() {
    super.load();
    consentInformation = UserMessagingPlatform.getConsentInformation(getContext());
  }

  @Override
  protected void handleOnDestroy() {
    pendingReadyRequests.clear();
    pendingAdRequests.clear();
    rewardedAd = null;
    pendingShowCallId = null;
    rewardEarnedForCurrentAd = false;
    super.handleOnDestroy();
  }

  @PluginMethod
  public void initialize(PluginCall call) {
    runOnMainThread(
        () ->
            ensureSdkReady(
                () -> {
                  JSObject result = new JSObject();
                  result.put("ok", true);
                  result.put("consentStatus", getConsentStatusName());
                  result.put("privacyOptionsRequired", isPrivacyOptionsRequired());
                  call.resolve(result);
                },
                error -> call.reject(error)));
  }

  @PluginMethod
  public void showRewardedAd(PluginCall call) {
    String userId = trim(call.getString("userId"));
    String customData = trim(call.getString("customData"));
    if (userId.isEmpty()) {
      call.reject("userId required");
      return;
    }
    if (customData.isEmpty()) {
      call.reject("customData required");
      return;
    }
    if (pendingShowCallId != null) {
      call.reject("rewarded_ad_already_showing");
      return;
    }
    if (getActivity() == null) {
      call.reject("activity_unavailable");
      return;
    }

    getBridge().saveCall(call);
    pendingShowCallId = call.getCallbackId();
    rewardEarnedForCurrentAd = false;

    runOnMainThread(
        () ->
            ensureSdkReady(
                () ->
                    ensureRewardedAdReady(
                        () -> showInternal(userId, customData), this::rejectPendingShow),
                this::rejectPendingShow));
  }

  @PluginMethod
  public void showPrivacyOptionsForm(PluginCall call) {
    runOnMainThread(
        () ->
            ensureSdkReady(
                () -> {
                  Activity activity = getActivity();
                  if (activity == null) {
                    call.reject("activity_unavailable");
                    return;
                  }
                  if (!isPrivacyOptionsRequired()) {
                    JSObject result = new JSObject();
                    result.put("shown", false);
                    result.put("status", getConsentStatusName());
                    call.resolve(result);
                    return;
                  }
                  UserMessagingPlatform.showPrivacyOptionsForm(
                      activity,
                      (FormError formError) -> {
                        if (formError != null) {
                          call.reject("privacy_options_failed:" + trim(formError.getMessage()));
                          return;
                        }
                        JSObject result = new JSObject();
                        result.put("shown", true);
                        result.put("status", getConsentStatusName());
                        call.resolve(result);
                      });
                },
                error -> call.reject(error)));
  }

  private void ensureSdkReady(Runnable onReady, Consumer<String> onError) {
    if (sdkReady) {
      onReady.run();
      return;
    }

    pendingReadyRequests.add(new PendingReadyRequest(onReady, onError));
    if (initInFlight) {
      return;
    }

    Activity activity = getActivity();
    if (activity == null) {
      flushReadyError("activity_unavailable");
      return;
    }

    String manifestAppId = readManifestAppId();
    if (manifestAppId.isEmpty()) {
      flushReadyError("admob_app_id_missing");
      return;
    }

    initInFlight = true;

    ConsentRequestParameters.Builder paramsBuilder = new ConsentRequestParameters.Builder();
    if (com.nerbuss.fhsmanager.BuildConfig.DEBUG) {
      ConsentDebugSettings debugSettings =
          new ConsentDebugSettings.Builder(getContext()).build();
      paramsBuilder.setConsentDebugSettings(debugSettings);
    }

    consentInformation.requestConsentInfoUpdate(
        activity,
        paramsBuilder.build(),
        () ->
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(
                activity,
                (FormError formError) -> {
                  if (formError != null) {
                    Log.w(TAG, "Consent form dismissed with error: " + formError.getMessage());
                  }
                  initializeMobileAdsAndPreload();
                }),
        (FormError formError) -> {
          Log.w(
              TAG,
              "Consent info update failed: "
                  + (formError == null ? "unknown" : formError.getMessage()));
          initializeMobileAdsAndPreload();
        });
  }

  private void initializeMobileAdsAndPreload() {
    if (!mobileAdsInitialized) {
      MobileAds.initialize(
          getContext(),
          initializationStatus -> {
            mobileAdsInitialized = true;
            completeInitialization();
          });
      return;
    }

    completeInitialization();
  }

  private void completeInitialization() {
    sdkReady = true;
    initInFlight = false;
    ensureRewardedAdReady(
        this::flushReadySuccess,
        error -> {
          Log.w(TAG, "Rewarded preload failed during init: " + error);
          flushReadySuccess();
        });
  }

  private void flushReadySuccess() {
    List<PendingReadyRequest> requests = new ArrayList<>(pendingReadyRequests);
    pendingReadyRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onReady.run();
    }
  }

  private void flushReadyError(String error) {
    initInFlight = false;
    List<PendingReadyRequest> requests = new ArrayList<>(pendingReadyRequests);
    pendingReadyRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onError.accept(error);
    }
  }

  private void ensureRewardedAdReady(Runnable onReady, Consumer<String> onError) {
    if (rewardedAd != null) {
      onReady.run();
      return;
    }

    pendingAdRequests.add(new PendingReadyRequest(onReady, onError));
    if (adLoadInFlight) {
      return;
    }

    final String adUnitId = trim(com.nerbuss.fhsmanager.BuildConfig.ADMOB_REWARDED_AD_UNIT_ID);
    if (adUnitId.isEmpty()) {
      flushAdError("rewarded_ad_unit_missing");
      return;
    }

    adLoadInFlight = true;
    RewardedAd.load(
        getContext(),
        adUnitId,
        new AdRequest.Builder().build(),
        new RewardedAdLoadCallback() {
          @Override
          public void onAdLoaded(RewardedAd ad) {
            rewardedAd = ad;
            adLoadInFlight = false;
            flushAdSuccess();
          }

          @Override
          public void onAdFailedToLoad(LoadAdError loadAdError) {
            rewardedAd = null;
            adLoadInFlight = false;
            flushAdError(
                "rewarded_load_failed:"
                    + (loadAdError == null ? "unknown" : loadAdError.getCode())
                    + ":"
                    + (loadAdError == null ? "" : trim(loadAdError.getMessage())));
          }
        });
  }

  private void flushAdSuccess() {
    List<PendingReadyRequest> requests = new ArrayList<>(pendingAdRequests);
    pendingAdRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onReady.run();
    }
  }

  private void flushAdError(String error) {
    List<PendingReadyRequest> requests = new ArrayList<>(pendingAdRequests);
    pendingAdRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onError.accept(error);
    }
  }

  private void showInternal(String userId, String customData) {
    Activity activity = getActivity();
    RewardedAd ad = rewardedAd;
    if (activity == null || ad == null) {
      rejectPendingShow("rewarded_ad_not_ready");
      ensureRewardedAdReady(() -> {}, error -> Log.w(TAG, error));
      return;
    }

    ServerSideVerificationOptions options =
        new ServerSideVerificationOptions.Builder()
            .setUserId(userId)
            .setCustomData(customData)
            .build();
    ad.setServerSideVerificationOptions(options);
    ad.setFullScreenContentCallback(
        new FullScreenContentCallback() {
          @Override
          public void onAdDismissedFullScreenContent() {
            JSObject payload = new JSObject();
            payload.put("status", rewardEarnedForCurrentAd ? "earned" : "dismissed");
            resolvePendingShow(payload);
            rewardedAd = null;
            rewardEarnedForCurrentAd = false;
            ensureRewardedAdReady(() -> {}, error -> Log.w(TAG, error));
          }

          @Override
          public void onAdFailedToShowFullScreenContent(AdError adError) {
            JSObject payload = new JSObject();
            payload.put("status", "failed");
            payload.put("message", adError == null ? "show_failed" : trim(adError.getMessage()));
            payload.put("responseCode", adError == null ? -1 : adError.getCode());
            resolvePendingShow(payload);
            rewardedAd = null;
            rewardEarnedForCurrentAd = false;
            ensureRewardedAdReady(() -> {}, error -> Log.w(TAG, error));
          }
        });

    rewardedAd = null;
    ad.show(
        activity,
        (RewardItem rewardItem) -> {
          rewardEarnedForCurrentAd = true;
          Log.d(
              TAG,
              "Reward earned: "
                  + (rewardItem == null ? "unknown" : rewardItem.getAmount())
                  + " "
                  + (rewardItem == null ? "" : rewardItem.getType()));
        });
  }

  private void resolvePendingShow(JSObject payload) {
    PluginCall call =
        pendingShowCallId == null ? null : getBridge().getSavedCall(pendingShowCallId);
    pendingShowCallId = null;
    if (call == null) {
      return;
    }
    call.resolve(payload);
  }

  private void rejectPendingShow(String error) {
    PluginCall call =
        pendingShowCallId == null ? null : getBridge().getSavedCall(pendingShowCallId);
    pendingShowCallId = null;
    rewardEarnedForCurrentAd = false;
    if (call == null) {
      return;
    }
    call.reject(error);
  }

  private String readManifestAppId() {
    try {
      PackageManager packageManager = getContext().getPackageManager();
      ApplicationInfo appInfo =
          packageManager.getApplicationInfo(
              getContext().getPackageName(), PackageManager.GET_META_DATA);
      if (appInfo.metaData == null) {
        return "";
      }
      return trim(appInfo.metaData.getString(META_APP_ID, ""));
    } catch (Exception error) {
      Log.w(TAG, "Unable to read AdMob app id", error);
      return "";
    }
  }

  private boolean isPrivacyOptionsRequired() {
    if (consentInformation == null) {
      return false;
    }
    return consentInformation.getPrivacyOptionsRequirementStatus()
        == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
  }

  private String getConsentStatusName() {
    if (consentInformation == null) {
      return "UNKNOWN";
    }
    switch (consentInformation.getConsentStatus()) {
      case ConsentInformation.ConsentStatus.REQUIRED:
        return "REQUIRED";
      case ConsentInformation.ConsentStatus.NOT_REQUIRED:
        return "NOT_REQUIRED";
      case ConsentInformation.ConsentStatus.OBTAINED:
        return "OBTAINED";
      default:
        return "UNKNOWN";
    }
  }

  private void runOnMainThread(Runnable action) {
    Activity activity = getActivity();
    if (activity == null) {
      action.run();
      return;
    }
    activity.runOnUiThread(action);
  }

  private static String trim(String raw) {
    return TextUtils.isEmpty(raw) ? "" : raw.trim();
  }

  private static final class PendingReadyRequest {
    private final Runnable onReady;
    private final Consumer<String> onError;

    private PendingReadyRequest(Runnable onReady, Consumer<String> onError) {
      this.onReady = onReady;
      this.onError = onError;
    }
  }
}
