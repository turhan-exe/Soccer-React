package com.nerbuss.fhsmanager.ads;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.Log;
import com.google.android.gms.ads.AdError;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.FullScreenContentCallback;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.rewarded.RewardedAd;
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback;
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions;
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAd;
import com.google.android.gms.ads.rewardedinterstitial.RewardedInterstitialAdLoadCallback;
import com.nerbuss.fhsmanager.BuildConfig;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

public final class UnityRewardedAdBridge {
  private static final String TAG = "UnityRewardedAdBridge";
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static boolean initialized;
  private static boolean showing;

  private UnityRewardedAdBridge() {}

  public static void showRewardedAd(
      String unityObjectName,
      String unityCallbackMethod,
      String userId,
      String customData) {
    MAIN.post(
        () -> {
          if (showing) {
            send(unityObjectName, unityCallbackMethod, "failed", "rewarded_ad_already_showing");
            return;
          }

          Activity activity = getUnityActivity();
          if (activity == null) {
            send(unityObjectName, unityCallbackMethod, "failed", "activity_unavailable");
            return;
          }

          String safeUserId = trim(userId);
          String safeCustomData = trim(customData);
          if (safeUserId.isEmpty() || safeCustomData.isEmpty()) {
            send(unityObjectName, unityCallbackMethod, "failed", "user_or_custom_data_missing");
            return;
          }

          showing = true;
          tryInitialize(activity);
          loadRewarded(
              activity,
              unityObjectName,
              unityCallbackMethod,
              safeUserId,
              safeCustomData,
              true);
        });
  }

  private static void loadRewarded(
      Activity activity,
      String unityObjectName,
      String unityCallbackMethod,
      String safeUserId,
      String safeCustomData,
      boolean allowFormatFallback) {
    RewardedAd.load(
        activity,
        BuildConfig.ADMOB_REWARDED_AD_UNIT_ID,
        new AdRequest.Builder().build(),
        new RewardedAdLoadCallback() {
          @Override
          public void onAdFailedToLoad(LoadAdError error) {
            String message =
                error != null
                    ? "load_failed:" + error.getCode() + ":" + error.getMessage()
                    : "load_failed";
            if (allowFormatFallback && isFormatMismatch(error)) {
              Log.w(TAG, "Rewarded load format mismatch, retrying as rewarded interstitial.");
              loadRewardedInterstitial(
                  activity, unityObjectName, unityCallbackMethod, safeUserId, safeCustomData);
              return;
            }

            showing = false;
            Log.w(TAG, message);
            send(unityObjectName, unityCallbackMethod, "failed", message);
          }

          @Override
          public void onAdLoaded(RewardedAd ad) {
            if (ad == null) {
              showing = false;
              send(unityObjectName, unityCallbackMethod, "failed", "ad_loaded_null");
              return;
            }

            ServerSideVerificationOptions options =
                new ServerSideVerificationOptions.Builder()
                    .setUserId(safeUserId)
                    .setCustomData(safeCustomData)
                    .build();
            ad.setServerSideVerificationOptions(options);
            final boolean[] earned = new boolean[] {false};
            ad.setFullScreenContentCallback(createFullScreenCallback(unityObjectName, unityCallbackMethod, earned));
            ad.show(activity, rewardItem -> earned[0] = true);
          }
        });
  }

  private static void loadRewardedInterstitial(
      Activity activity,
      String unityObjectName,
      String unityCallbackMethod,
      String safeUserId,
      String safeCustomData) {
    RewardedInterstitialAd.load(
        activity,
        BuildConfig.ADMOB_REWARDED_AD_UNIT_ID,
        new AdRequest.Builder().build(),
        new RewardedInterstitialAdLoadCallback() {
          @Override
          public void onAdFailedToLoad(LoadAdError error) {
            showing = false;
            String message =
                error != null
                    ? "load_failed:" + error.getCode() + ":" + error.getMessage()
                    : "load_failed";
            Log.w(TAG, message);
            send(unityObjectName, unityCallbackMethod, "failed", message);
          }

          @Override
          public void onAdLoaded(RewardedInterstitialAd ad) {
            if (ad == null) {
              showing = false;
              send(unityObjectName, unityCallbackMethod, "failed", "ad_loaded_null");
              return;
            }

            ServerSideVerificationOptions options =
                new ServerSideVerificationOptions.Builder()
                    .setUserId(safeUserId)
                    .setCustomData(safeCustomData)
                    .build();
            ad.setServerSideVerificationOptions(options);
            final boolean[] earned = new boolean[] {false};
            ad.setFullScreenContentCallback(createFullScreenCallback(unityObjectName, unityCallbackMethod, earned));
            ad.show(activity, rewardItem -> earned[0] = true);
          }
        });
  }

  private static FullScreenContentCallback createFullScreenCallback(
      String unityObjectName,
      String unityCallbackMethod,
      boolean[] earned) {
    return new FullScreenContentCallback() {
      @Override
      public void onAdDismissedFullScreenContent() {
        showing = false;
        send(
            unityObjectName,
            unityCallbackMethod,
            earned[0] ? "earned" : "dismissed",
            earned[0] ? "earned" : "dismissed");
      }

      @Override
      public void onAdFailedToShowFullScreenContent(AdError adError) {
        showing = false;
        String message =
            adError != null
                ? "show_failed:" + adError.getCode() + ":" + adError.getMessage()
                : "show_failed";
        Log.w(TAG, message);
        send(unityObjectName, unityCallbackMethod, "failed", message);
      }
    };
  }

  private static void tryInitialize(Activity activity) {
    if (initialized) {
      return;
    }
    initialized = true;
    try {
      MobileAds.initialize(activity, status -> Log.d(TAG, "MobileAds initialized for Unity."));
    } catch (Throwable error) {
      Log.w(TAG, "MobileAds initialize failed", error);
    }
  }

  private static void send(String objectName, String methodName, String status, String message) {
    String safeObject = trim(objectName);
    String safeMethod = trim(methodName);
    if (safeObject.isEmpty() || safeMethod.isEmpty()) {
      return;
    }

    String json =
        "{\"status\":\""
            + escape(status)
            + "\",\"message\":\""
            + escape(message)
            + "\"}";
    try {
      Class<?> unityPlayer = Class.forName("com.unity3d.player.UnityPlayer");
      Method unitySendMessage =
          unityPlayer.getMethod("UnitySendMessage", String.class, String.class, String.class);
      unitySendMessage.invoke(null, safeObject, safeMethod, json);
    } catch (Throwable error) {
      Log.w(TAG, "Unity callback failed", error);
    }
  }

  private static Activity getUnityActivity() {
    try {
      Class<?> unityPlayer = Class.forName("com.unity3d.player.UnityPlayer");
      Field currentActivity = unityPlayer.getField("currentActivity");
      Object value = currentActivity.get(null);
      return value instanceof Activity ? (Activity) value : null;
    } catch (Throwable error) {
      Log.w(TAG, "Unity activity lookup failed", error);
      return null;
    }
  }

  private static String trim(String value) {
    return value == null ? "" : value.trim();
  }

  private static boolean isFormatMismatch(LoadAdError error) {
    String message = trim(error == null ? null : error.getMessage()).toLowerCase();
    return message.contains("match format");
  }

  private static String escape(String value) {
    return TextUtils.isEmpty(value)
        ? ""
        : value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n");
  }
}
