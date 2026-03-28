package com.nerbuss.fhsmanager.ads;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import com.google.android.gms.ads.OnUserEarnedRewardListener;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.ResponseInfo;
import com.google.android.gms.ads.rewarded.RewardItem;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAd;
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAdLoadCallback;
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
  private static final String ERROR_DOMAIN_PLUGIN = "rewarded_ads_plugin";
  private static final long MAX_CACHED_AD_AGE_MS = 55L * 60L * 1000L;
  private static final long SHOW_TIMEOUT_MS = 15_000L;
  private static final long RETRY_DELAY_MS = 1_500L;

  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final List<PendingReadyRequest> pendingReadyRequests = new ArrayList<>();
  private final List<PendingReadyRequest> pendingAdRequests = new ArrayList<>();

  private ConsentInformation consentInformation;
  private LoadedRewardedAdHandle rewardedAd;
  private RewardedAdErrorSnapshot lastLoadError;
  private RewardedAdErrorSnapshot lastShowError;

  private boolean initInFlight = false;
  private boolean sdkReady = false;
  private boolean mobileAdsInitialized = false;
  private boolean adLoadInFlight = false;
  private long rewardedAdLoadedAtMs = 0L;
  private String rewardedAdFormat = "";

  private String pendingShowCallId;
  private boolean rewardEarnedForCurrentAd = false;
  private Runnable pendingShowTimeoutRunnable;

  @Override
  public void load() {
    super.load();
    consentInformation = UserMessagingPlatform.getConsentInformation(getContext());
  }

  @Override
  protected void handleOnDestroy() {
    pendingReadyRequests.clear();
    pendingAdRequests.clear();
    cancelPendingShowTimeout();
    clearCachedRewardedAd();
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
                  result.put("debug", buildCurrentDebugInfo());
                  call.resolve(result);
                },
                error -> call.reject(error.message != null ? error.message : "rewarded_init_failed")));
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
      call.resolve(
          buildFailedResultPayload(
              createErrorSnapshot("show", null, ERROR_DOMAIN_PLUGIN, "rewarded_ad_already_showing", null, null, false)));
      return;
    }
    if (getActivity() == null) {
      call.resolve(
          buildFailedResultPayload(
              createErrorSnapshot("show", null, ERROR_DOMAIN_PLUGIN, "activity_unavailable", null, null, false)));
      return;
    }

    getBridge().saveCall(call);
    pendingShowCallId = call.getCallbackId();
    rewardEarnedForCurrentAd = false;
    lastShowError = null;
    final String currentShowCallId = call.getCallbackId();
    schedulePendingShowTimeout(currentShowCallId);

    runOnMainThread(
        () ->
            ensureSdkReady(
                () ->
                    ensureRewardedAdReady(
                        () -> {
                          if (!currentShowCallId.equals(pendingShowCallId)) {
                            return;
                          }
                          showInternal(currentShowCallId, userId, customData);
                        },
                        error -> {
                          if (!currentShowCallId.equals(pendingShowCallId)) {
                            return;
                          }
                          resolvePendingShowFailed(error);
                        }),
                error -> {
                  if (!currentShowCallId.equals(pendingShowCallId)) {
                    return;
                  }
                  resolvePendingShowFailed(error);
                }));
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
                error -> call.reject(error.message != null ? error.message : "privacy_options_failed")));
  }

  @PluginMethod
  public void getRewardedAdsDebugInfo(PluginCall call) {
    call.resolve(buildCurrentDebugInfo());
  }

  @PluginMethod
  public void openAdInspector(PluginCall call) {
    runOnMainThread(
        () ->
            ensureSdkReady(
                () -> {
                  Activity activity = getActivity();
                  if (activity == null) {
                    JSObject result = new JSObject();
                    RewardedAdErrorSnapshot snapshot =
                        createErrorSnapshot("show", null, ERROR_DOMAIN_PLUGIN, "activity_unavailable", null, null, false);
                    result.put("opened", false);
                    result.put("error", buildErrorPayload(snapshot));
                    result.put("debug", buildCurrentDebugInfo());
                    call.resolve(result);
                    return;
                  }
                  MobileAds.openAdInspector(
                      activity,
                      adInspectorError -> {
                        JSObject result = new JSObject();
                        result.put("opened", adInspectorError == null);
                        if (adInspectorError != null) {
                          RewardedAdErrorSnapshot snapshot =
                              createErrorSnapshot(
                                  "show",
                                  adInspectorError.getCode(),
                                  adInspectorError.getDomain(),
                                  trim(adInspectorError.getMessage()),
                                  null,
                                  null,
                                  false);
                          result.put("error", buildErrorPayload(snapshot));
                        }
                        result.put("debug", buildCurrentDebugInfo());
                        call.resolve(result);
                      });
                },
                error -> {
                  JSObject result = new JSObject();
                  result.put("opened", false);
                  result.put("error", buildErrorPayload(error));
                  result.put("debug", buildCurrentDebugInfo());
                  call.resolve(result);
                }));
  }

  private void ensureSdkReady(Runnable onReady, Consumer<RewardedAdErrorSnapshot> onError) {
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
      flushReadyError(
          createErrorSnapshot("init", null, ERROR_DOMAIN_PLUGIN, "activity_unavailable", null, null, false));
      return;
    }

    String manifestAppId = readManifestAppId();
    if (manifestAppId.isEmpty()) {
      flushReadyError(
          createErrorSnapshot("init", null, ERROR_DOMAIN_PLUGIN, "admob_app_id_missing", null, null, false));
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
          Log.w(TAG, "Rewarded preload failed during init: " + error.message);
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

  private void flushReadyError(RewardedAdErrorSnapshot error) {
    initInFlight = false;
    List<PendingReadyRequest> requests = new ArrayList<>(pendingReadyRequests);
    pendingReadyRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onError.accept(error);
    }
  }

  private void ensureRewardedAdReady(Runnable onReady, Consumer<RewardedAdErrorSnapshot> onError) {
    if (rewardedAd != null && !isRewardedAdExpired()) {
      onReady.run();
      return;
    }

    if (rewardedAd != null && isRewardedAdExpired()) {
      clearCachedRewardedAd();
    }

    pendingAdRequests.add(new PendingReadyRequest(onReady, onError));
    if (adLoadInFlight) {
      return;
    }

    final String adUnitId = trim(com.nerbuss.fhsmanager.BuildConfig.ADMOB_REWARDED_AD_UNIT_ID);
    if (adUnitId.isEmpty()) {
      RewardedAdErrorSnapshot error =
          createErrorSnapshot("load", null, ERROR_DOMAIN_PLUGIN, "rewarded_ad_unit_missing", null, null, false);
      lastLoadError = error;
      flushAdError(error);
      return;
    }

    loadRewardedAd(0);
  }

  private void loadRewardedAd(int attempt) {
    loadStandardRewardedAd(attempt, true);
  }

  private void loadStandardRewardedAd(int attempt, boolean allowFormatFallback) {
    final String adUnitId = trim(com.nerbuss.fhsmanager.BuildConfig.ADMOB_REWARDED_AD_UNIT_ID);
    if (adUnitId.isEmpty()) {
      RewardedAdErrorSnapshot error =
          createErrorSnapshot("load", null, ERROR_DOMAIN_PLUGIN, "rewarded_ad_unit_missing", null, null, false);
      lastLoadError = error;
      flushAdError(error);
      return;
    }

    adLoadInFlight = true;
    Log.d(TAG, "Loading rewarded ad unit " + adUnitId + " as standard rewarded format");
    RewardedAd.load(
        getContext(),
        adUnitId,
        new AdRequest.Builder().build(),
        new RewardedAdLoadCallback() {
          @Override
          public void onAdLoaded(RewardedAd ad) {
            rewardedAd = new StandardRewardedAdHandle(ad);
            rewardedAdLoadedAtMs = System.currentTimeMillis();
            rewardedAdFormat = rewardedAd.getFormatName();
            adLoadInFlight = false;
            lastLoadError = null;
            flushAdSuccess();
          }

          @Override
          public void onAdFailedToLoad(LoadAdError loadAdError) {
            clearCachedRewardedAd();
            RewardedAdErrorSnapshot error = createLoadErrorSnapshot(loadAdError);

            if (allowFormatFallback && isFormatMismatchError(error)) {
              Log.w(TAG, "Standard rewarded load failed with format mismatch; retrying as rewarded interstitial");
              loadRewardedInterstitialAd(attempt);
              return;
            }

            if ((error.code != null && (error.code == 0 || error.code == 2)) && attempt == 0) {
              Log.w(TAG, "Retrying rewarded ad load after retryable error: " + error.message);
              mainHandler.postDelayed(() -> loadRewardedAd(attempt + 1), RETRY_DELAY_MS);
              return;
            }

            adLoadInFlight = false;
            lastLoadError = error;
            flushAdError(error);
          }
        });
  }

  private void loadRewardedInterstitialAd(int attempt) {
    final String adUnitId = trim(com.nerbuss.fhsmanager.BuildConfig.ADMOB_REWARDED_AD_UNIT_ID);
    if (adUnitId.isEmpty()) {
      RewardedAdErrorSnapshot error =
          createErrorSnapshot("load", null, ERROR_DOMAIN_PLUGIN, "rewarded_ad_unit_missing", null, null, false);
      lastLoadError = error;
      flushAdError(error);
      return;
    }

    adLoadInFlight = true;
    Log.d(TAG, "Loading rewarded ad unit " + adUnitId + " as rewarded interstitial format");
    RewardedInterstitialAd.load(
        getContext(),
        adUnitId,
        new AdRequest.Builder().build(),
        new RewardedInterstitialAdLoadCallback() {
          @Override
          public void onAdLoaded(RewardedInterstitialAd ad) {
            rewardedAd = new RewardedInterstitialAdHandle(ad);
            rewardedAdLoadedAtMs = System.currentTimeMillis();
            rewardedAdFormat = rewardedAd.getFormatName();
            adLoadInFlight = false;
            lastLoadError = null;
            flushAdSuccess();
          }

          @Override
          public void onAdFailedToLoad(LoadAdError loadAdError) {
            clearCachedRewardedAd();
            RewardedAdErrorSnapshot error = createLoadErrorSnapshot(loadAdError);

            if ((error.code != null && (error.code == 0 || error.code == 2)) && attempt == 0) {
              Log.w(TAG, "Retrying rewarded interstitial load after retryable error: " + error.message);
              mainHandler.postDelayed(() -> loadRewardedInterstitialAd(attempt + 1), RETRY_DELAY_MS);
              return;
            }

            adLoadInFlight = false;
            lastLoadError = error;
            flushAdError(error);
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

  private void flushAdError(RewardedAdErrorSnapshot error) {
    adLoadInFlight = false;
    List<PendingReadyRequest> requests = new ArrayList<>(pendingAdRequests);
    pendingAdRequests.clear();
    for (PendingReadyRequest request : requests) {
      request.onError.accept(error);
    }
  }

  private void showInternal(String expectedCallId, String userId, String customData) {
    if (!expectedCallId.equals(pendingShowCallId)) {
      return;
    }

    Activity activity = getActivity();
    LoadedRewardedAdHandle ad = rewardedAd;
    if (activity == null || ad == null) {
      resolvePendingShowFailed(
          createErrorSnapshot("show", null, ERROR_DOMAIN_PLUGIN, "rewarded_ad_not_ready", null, null, false));
      ensureRewardedAdReady(() -> {}, error -> Log.w(TAG, error.message));
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
          public void onAdShowedFullScreenContent() {
            cancelPendingShowTimeout();
            notifyRewardedLifecycle("showing", null);
          }

          @Override
          public void onAdDismissedFullScreenContent() {
            JSObject payload = new JSObject();
            payload.put("status", rewardEarnedForCurrentAd ? "earned" : "dismissed");
            payload.put("debug", buildCurrentDebugInfo());
            resolvePendingShow(payload);
            clearCachedRewardedAd();
            rewardEarnedForCurrentAd = false;
            notifyRewardedLifecycle("dismissed", null);
            ensureRewardedAdReady(() -> {}, error -> Log.w(TAG, error.message));
          }

          @Override
          public void onAdFailedToShowFullScreenContent(AdError adError) {
            clearCachedRewardedAd();
            RewardedAdErrorSnapshot error = createShowErrorSnapshot(adError);
            lastShowError = error;
            notifyRewardedLifecycle("failed", error);
            resolvePendingShowFailed(error);
            rewardEarnedForCurrentAd = false;
            ensureRewardedAdReady(() -> {}, loadError -> Log.w(TAG, loadError.message));
          }
        });

    lastShowError = null;
    clearCachedRewardedAd();
    ad.show(
        activity,
        (RewardItem rewardItem) -> {
          rewardEarnedForCurrentAd = true;
          notifyRewardedLifecycle("earned", null);
          Log.d(
              TAG,
              "Reward earned: "
                  + (rewardItem == null ? "unknown" : rewardItem.getAmount())
                  + " "
                  + (rewardItem == null ? "" : rewardItem.getType()));
        });
  }

  private void resolvePendingShow(JSObject payload) {
    cancelPendingShowTimeout();
    PluginCall call =
        pendingShowCallId == null ? null : getBridge().getSavedCall(pendingShowCallId);
    pendingShowCallId = null;
    if (call == null) {
      rewardEarnedForCurrentAd = false;
      return;
    }
    call.resolve(payload);
  }

  private void resolvePendingShowFailed(RewardedAdErrorSnapshot error) {
    lastShowError = error;
    resolvePendingShow(buildFailedResultPayload(error));
    rewardEarnedForCurrentAd = false;
  }

  private JSObject buildFailedResultPayload(RewardedAdErrorSnapshot error) {
    JSObject payload = new JSObject();
    payload.put("status", "failed");
    payload.put("message", error.message);
    if (error.code != null) {
      payload.put("responseCode", error.code);
    }
    payload.put("debugMessage", error.responseInfo);
    payload.put("error", buildErrorPayload(error));
    payload.put("debug", buildCurrentDebugInfo());
    return payload;
  }

  private void notifyRewardedLifecycle(String status, RewardedAdErrorSnapshot error) {
    JSObject payload = new JSObject();
    payload.put("status", status);
    if (error != null) {
      payload.put("error", buildErrorPayload(error));
    }
    payload.put("debug", buildCurrentDebugInfo());
    notifyListeners("rewardedAdLifecycle", payload);
  }

  private void schedulePendingShowTimeout(String expectedCallId) {
    cancelPendingShowTimeout();
    pendingShowTimeoutRunnable =
        () -> {
          if (pendingShowCallId == null || !expectedCallId.equals(pendingShowCallId)) {
            return;
          }
          RewardedAdErrorSnapshot timeoutError =
              createErrorSnapshot("load", null, ERROR_DOMAIN_PLUGIN, "rewarded_load_timeout", null, null, true);
          notifyRewardedLifecycle("failed", timeoutError);
          resolvePendingShowFailed(timeoutError);
        };
    mainHandler.postDelayed(pendingShowTimeoutRunnable, SHOW_TIMEOUT_MS);
  }

  private void cancelPendingShowTimeout() {
    if (pendingShowTimeoutRunnable != null) {
      mainHandler.removeCallbacks(pendingShowTimeoutRunnable);
      pendingShowTimeoutRunnable = null;
    }
  }

  private boolean isRewardedAdExpired() {
    return rewardedAdLoadedAtMs > 0L
        && System.currentTimeMillis() - rewardedAdLoadedAtMs >= MAX_CACHED_AD_AGE_MS;
  }

  private void clearCachedRewardedAd() {
    rewardedAd = null;
    rewardedAdLoadedAtMs = 0L;
    rewardedAdFormat = "";
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

  private JSObject buildCurrentDebugInfo() {
    JSObject debug = new JSObject();
    debug.put("sdkReady", sdkReady);
    debug.put("mobileAdsInitialized", mobileAdsInitialized);
    debug.put("adLoaded", rewardedAd != null && !isRewardedAdExpired());
    debug.put("adLoadInFlight", adLoadInFlight);
    debug.put("loadedAtMs", rewardedAdLoadedAtMs > 0L ? rewardedAdLoadedAtMs : null);
    debug.put(
        "adAgeMs",
        rewardedAdLoadedAtMs > 0L ? Math.max(0L, System.currentTimeMillis() - rewardedAdLoadedAtMs) : null);
    debug.put("consentStatus", getConsentStatusName());
    debug.put("privacyOptionsRequired", isPrivacyOptionsRequired());
    debug.put("isTestDevice", isTestDevice());
    debug.put("admobUseTestIds", com.nerbuss.fhsmanager.BuildConfig.ADMOB_USE_TEST_IDS);
    debug.put("appVersionName", getVersionName());
    debug.put("versionCode", getVersionCode());
    debug.put("installSource", getInstallSource());
    debug.put("deviceModel", trim(Build.MODEL));
    debug.put("sdkInt", Build.VERSION.SDK_INT);
    debug.put("networkType", getNetworkType());
    debug.put(
        "adUnitIdConfigured",
        !trim(com.nerbuss.fhsmanager.BuildConfig.ADMOB_REWARDED_AD_UNIT_ID).isEmpty());
    debug.put("adFormat", rewardedAdFormat.isEmpty() ? null : rewardedAdFormat);
    debug.put("lastLoadError", lastLoadError == null ? null : buildErrorPayload(lastLoadError));
    debug.put("lastShowError", lastShowError == null ? null : buildErrorPayload(lastShowError));
    return debug;
  }

  private JSObject buildErrorPayload(RewardedAdErrorSnapshot snapshot) {
    JSObject payload = new JSObject();
    payload.put("stage", snapshot.stage);
    payload.put("code", snapshot.code);
    payload.put("domain", snapshot.domain);
    payload.put("message", snapshot.message);
    payload.put("responseInfo", snapshot.responseInfo);
    payload.put("cause", snapshot.cause);
    payload.put("consentStatus", getConsentStatusName());
    payload.put("privacyOptionsRequired", isPrivacyOptionsRequired());
    payload.put("isTestDevice", isTestDevice());
    payload.put("loadedAtMs", rewardedAdLoadedAtMs > 0L ? rewardedAdLoadedAtMs : null);
    payload.put("timedOut", snapshot.timedOut);
    return payload;
  }

  private RewardedAdErrorSnapshot createLoadErrorSnapshot(LoadAdError loadAdError) {
    if (loadAdError == null) {
      return createErrorSnapshot("load", null, ERROR_DOMAIN_PLUGIN, "rewarded_load_failed", null, null, false);
    }
    ResponseInfo responseInfo = loadAdError.getResponseInfo();
    String cause = buildCauseString(loadAdError.getCause());
    return createErrorSnapshot(
        "load",
        loadAdError.getCode(),
        trim(loadAdError.getDomain()),
        trim(loadAdError.getMessage()),
        responseInfo == null ? null : trim(responseInfo.toString()),
        cause,
        false);
  }

  private RewardedAdErrorSnapshot createShowErrorSnapshot(AdError adError) {
    if (adError == null) {
      return createErrorSnapshot("show", null, ERROR_DOMAIN_PLUGIN, "show_failed", null, null, false);
    }
    return createErrorSnapshot(
        "show",
        adError.getCode(),
        trim(adError.getDomain()),
        trim(adError.getMessage()),
        null,
        buildCauseString(adError.getCause()),
        false);
  }

  private RewardedAdErrorSnapshot createErrorSnapshot(
      String stage,
      Integer code,
      String domain,
      String message,
      String responseInfo,
      String cause,
      boolean timedOut) {
    return new RewardedAdErrorSnapshot(
        trim(stage),
        code,
        trim(domain),
        trim(message),
        trim(responseInfo),
        trim(cause),
        timedOut);
  }

  private String buildCauseString(AdError cause) {
    if (cause == null) {
      return "";
    }
    StringBuilder builder = new StringBuilder();
    if (!trim(cause.getDomain()).isEmpty()) {
      builder.append(trim(cause.getDomain()));
    }
    if (cause.getCode() != 0 || builder.length() > 0) {
      if (builder.length() > 0) {
        builder.append(':');
      }
      builder.append(cause.getCode());
    }
    if (!trim(cause.getMessage()).isEmpty()) {
      if (builder.length() > 0) {
        builder.append(':');
      }
      builder.append(trim(cause.getMessage()));
    }
    return builder.toString();
  }

  private boolean isFormatMismatchError(RewardedAdErrorSnapshot error) {
    String message = trim(error == null ? null : error.message).toLowerCase();
    String cause = trim(error == null ? null : error.cause).toLowerCase();
    String responseInfo = trim(error == null ? null : error.responseInfo).toLowerCase();
    return message.contains("match format")
        || cause.contains("match format")
        || responseInfo.contains("match format");
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

  private boolean isPrivacyOptionsRequired() {
    if (consentInformation == null) {
      return false;
    }
    return consentInformation.getPrivacyOptionsRequirementStatus()
        == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
  }

  private boolean isTestDevice() {
    return com.nerbuss.fhsmanager.BuildConfig.DEBUG
        || com.nerbuss.fhsmanager.BuildConfig.ADMOB_USE_TEST_IDS;
  }

  private String getVersionName() {
    try {
      PackageManager packageManager = getContext().getPackageManager();
      PackageInfo packageInfo = packageManager.getPackageInfo(getContext().getPackageName(), 0);
      return trim(packageInfo.versionName);
    } catch (Exception error) {
      Log.w(TAG, "Unable to read version name", error);
      return "";
    }
  }

  private Long getVersionCode() {
    try {
      PackageManager packageManager = getContext().getPackageManager();
      PackageInfo packageInfo = packageManager.getPackageInfo(getContext().getPackageName(), 0);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        return packageInfo.getLongVersionCode();
      }
      return (long) packageInfo.versionCode;
    } catch (Exception error) {
      Log.w(TAG, "Unable to read version code", error);
      return null;
    }
  }

  private String getInstallSource() {
    try {
      PackageManager packageManager = getContext().getPackageManager();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        return trim(packageManager.getInstallSourceInfo(getContext().getPackageName()).getInstallingPackageName());
      }
      return trim(packageManager.getInstallerPackageName(getContext().getPackageName()));
    } catch (Exception error) {
      Log.w(TAG, "Unable to read install source", error);
      return "";
    }
  }

  private String getNetworkType() {
    try {
      ConnectivityManager connectivityManager =
          (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
      if (connectivityManager == null) {
        return "unknown";
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        Network network = connectivityManager.getActiveNetwork();
        if (network == null) {
          return "offline";
        }
        NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
        if (capabilities == null) {
          return "offline";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
          return "vpn";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
          return "wifi";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
          return "cellular";
        }
        if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
          return "ethernet";
        }
        return "other";
      }

      return "unknown";
    } catch (Exception error) {
      Log.w(TAG, "Unable to read network type", error);
      return "unknown";
    }
  }

  private void runOnMainThread(Runnable action) {
    Activity activity = getActivity();
    if (activity == null) {
      mainHandler.post(action);
      return;
    }
    activity.runOnUiThread(action);
  }

  private static String trim(String raw) {
    return TextUtils.isEmpty(raw) ? "" : raw.trim();
  }

  private static final class PendingReadyRequest {
    private final Runnable onReady;
    private final Consumer<RewardedAdErrorSnapshot> onError;

    private PendingReadyRequest(Runnable onReady, Consumer<RewardedAdErrorSnapshot> onError) {
      this.onReady = onReady;
      this.onError = onError;
    }
  }

  private interface LoadedRewardedAdHandle {
    void setServerSideVerificationOptions(ServerSideVerificationOptions options);

    void setFullScreenContentCallback(FullScreenContentCallback callback);

    void show(Activity activity, OnUserEarnedRewardListener listener);

    String getFormatName();
  }

  private static final class StandardRewardedAdHandle implements LoadedRewardedAdHandle {
    private final RewardedAd ad;

    private StandardRewardedAdHandle(RewardedAd ad) {
      this.ad = ad;
    }

    @Override
    public void setServerSideVerificationOptions(ServerSideVerificationOptions options) {
      ad.setServerSideVerificationOptions(options);
    }

    @Override
    public void setFullScreenContentCallback(FullScreenContentCallback callback) {
      ad.setFullScreenContentCallback(callback);
    }

    @Override
    public void show(Activity activity, OnUserEarnedRewardListener listener) {
      ad.show(activity, listener);
    }

    @Override
    public String getFormatName() {
      return "rewarded";
    }
  }

  private static final class RewardedInterstitialAdHandle implements LoadedRewardedAdHandle {
    private final RewardedInterstitialAd ad;

    private RewardedInterstitialAdHandle(RewardedInterstitialAd ad) {
      this.ad = ad;
    }

    @Override
    public void setServerSideVerificationOptions(ServerSideVerificationOptions options) {
      ad.setServerSideVerificationOptions(options);
    }

    @Override
    public void setFullScreenContentCallback(FullScreenContentCallback callback) {
      ad.setFullScreenContentCallback(callback);
    }

    @Override
    public void show(Activity activity, OnUserEarnedRewardListener listener) {
      ad.show(activity, listener);
    }

    @Override
    public String getFormatName() {
      return "rewarded_interstitial";
    }
  }

  private static final class RewardedAdErrorSnapshot {
    private final String stage;
    private final Integer code;
    private final String domain;
    private final String message;
    private final String responseInfo;
    private final String cause;
    private final boolean timedOut;

    private RewardedAdErrorSnapshot(
        String stage,
        Integer code,
        String domain,
        String message,
        String responseInfo,
        String cause,
        boolean timedOut) {
      this.stage = stage;
      this.code = code;
      this.domain = domain;
      this.message = message;
      this.responseInfo = responseInfo;
      this.cause = cause;
      this.timedOut = timedOut;
    }
  }
}
