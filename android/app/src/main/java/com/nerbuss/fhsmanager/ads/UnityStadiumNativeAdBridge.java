package com.nerbuss.fhsmanager.ads;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.MobileAds;
import com.google.android.gms.ads.nativead.AdChoicesView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;
import com.nerbuss.fhsmanager.BuildConfig;
import java.lang.ref.WeakReference;
import java.lang.reflect.Field;
import java.util.LinkedHashMap;
import java.util.Map;

public final class UnityStadiumNativeAdBridge {
  private static final String TAG = "UnityStadiumNativeAds";
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static final int MAX_VISIBLE_SLOTS = 3;
  private static final long SLOT_REFRESH_INTERVAL_MS = 60_000L;
  private static final long SLOT_RETRY_INTERVAL_MS = 30_000L;
  private static final float MIN_VIEW_ALPHA = 0.0001f;

  private static final Map<String, SlotState> slots = new LinkedHashMap<>();
  private static WeakReference<Activity> hostActivityRef = new WeakReference<>(null);
  private static FrameLayout overlayRoot;
  private static boolean initialized;

  private UnityStadiumNativeAdBridge() {}

  public static void preloadStadiumNativeAds() {
    MAIN.post(
        () -> {
          Activity activity = getUnityActivity();
          if (activity == null) {
            return;
          }

          ensureHostOverlay(activity);
          tryInitialize(activity);
          for (SlotState slot : slots.values()) {
            loadAdIfNeeded(activity, slot, false, false);
          }
        });
  }

  public static void showStadiumNativeSlot(String slotId, int x, int y, int width, int height) {
    MAIN.post(() -> upsertSlot(slotId, x, y, width, height));
  }

  public static void updateStadiumNativeSlot(String slotId, int x, int y, int width, int height) {
    MAIN.post(() -> upsertSlot(slotId, x, y, width, height));
  }

  public static void hideStadiumNativeSlot(String slotId) {
    MAIN.post(
        () -> {
          SlotState slot = slots.get(trim(slotId));
          if (slot == null) {
            return;
          }

          slot.desiredVisible = false;
          if (slot.viewHolder != null) {
            slot.viewHolder.root.setVisibility(View.GONE);
          }
        });
  }

  public static void destroyAllStadiumNativeSlots() {
    MAIN.post(UnityStadiumNativeAdBridge::destroyAllInternal);
  }

  private static void upsertSlot(String rawSlotId, int x, int y, int width, int height) {
    String slotId = trim(rawSlotId);
    if (slotId.isEmpty()) {
      return;
    }

    if (width <= 0 || height <= 0) {
      hideStadiumNativeSlot(slotId);
      return;
    }

    Activity activity = getUnityActivity();
    if (activity == null) {
      return;
    }

    ensureHostOverlay(activity);
    tryInitialize(activity);

    SlotState slot = slots.get(slotId);
    if (slot == null) {
      if (slots.size() >= MAX_VISIBLE_SLOTS) {
        Log.d(TAG, "Ignoring stadium native slot beyond cap: " + slotId);
        return;
      }

      slot = new SlotState(slotId);
      slots.put(slotId, slot);
    }

    slot.desiredVisible = true;
    int safeLeft = Math.max(0, x);
    int safeBottom = Math.max(0, y);
    int safeWidth = Math.max(1, width);
    int safeHeight = Math.max(1, height);
    slot.rect.set(safeLeft, safeBottom, safeLeft + safeWidth, safeBottom + safeHeight);

    ensureSlotView(activity, slot);
    positionSlot(slot);
    if (slot.nativeAd != null) {
      if (!slot.loading && SystemClock.elapsedRealtime() >= slot.nextLoadEligibleAtMs) {
        loadAdIfNeeded(activity, slot, true, true);
      }
      bindNativeAd(slot);
      return;
    }

    loadAdIfNeeded(activity, slot, true, false);
  }

  private static void ensureHostOverlay(Activity activity) {
    Activity previous = hostActivityRef.get();
    if (overlayRoot != null && previous == activity && overlayRoot.getParent() != null) {
      return;
    }

    if (previous != activity) {
      destroyAllInternal();
    }

    hostActivityRef = new WeakReference<>(activity);
    View content = activity.findViewById(android.R.id.content);
    if (!(content instanceof ViewGroup contentRoot)) {
      return;
    }

    FrameLayout newRoot = new FrameLayout(activity);
    newRoot.setClipChildren(false);
    newRoot.setClipToPadding(false);
    newRoot.setClickable(false);
    newRoot.setFocusable(false);
    newRoot.setAlpha(1f);
    newRoot.setLayoutParams(
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    contentRoot.addView(newRoot);
    overlayRoot = newRoot;
  }

  private static void tryInitialize(Activity activity) {
    if (initialized) {
      return;
    }

    initialized = true;
    try {
      MobileAds.initialize(activity, status -> Log.d(TAG, "MobileAds initialized for stadium native overlay."));
    } catch (Throwable error) {
      Log.w(TAG, "MobileAds initialize failed for stadium overlay", error);
    }
  }

  private static void loadAdIfNeeded(
      Activity activity, SlotState slot, boolean immediateRetry, boolean forceRefreshExisting) {
    if (slot == null || slot.loading) {
      return;
    }

    if (slot.nativeAd != null && !forceRefreshExisting) {
      return;
    }

    long now = SystemClock.elapsedRealtime();
    if (!immediateRetry && now < slot.nextLoadEligibleAtMs) {
      return;
    }

    slot.loading = true;
    slot.nextLoadEligibleAtMs = now + SLOT_RETRY_INTERVAL_MS;
    AdLoader loader =
        new AdLoader.Builder(activity, BuildConfig.ADMOB_STADIUM_NATIVE_AD_UNIT_ID)
            .forNativeAd(
                nativeAd -> {
                  slot.loading = false;
                  slot.nextLoadEligibleAtMs = SystemClock.elapsedRealtime() + SLOT_REFRESH_INTERVAL_MS;
                  if (slot.nativeAd != null) {
                    slot.nativeAd.destroy();
                  }
                  slot.nativeAd = nativeAd;
                  if (slot.desiredVisible) {
                    ensureSlotView(activity, slot);
                    positionSlot(slot);
                    bindNativeAd(slot);
                  }
                })
            .withNativeAdOptions(new NativeAdOptions.Builder().build())
            .withAdListener(
                new AdListener() {
                  @Override
                  public void onAdFailedToLoad(LoadAdError error) {
                    slot.loading = false;
                    slot.nextLoadEligibleAtMs = SystemClock.elapsedRealtime() + SLOT_RETRY_INTERVAL_MS;
                    String message =
                        error != null
                            ? "load_failed:" + error.getCode() + ":" + error.getMessage()
                            : "load_failed";
                    Log.d(TAG, "Stadium native slot " + slot.slotId + " failed: " + message);
                    if (slot.viewHolder != null && slot.nativeAd == null) {
                      slot.viewHolder.root.setVisibility(View.GONE);
                    }
                  }
                })
            .build();

    loader.loadAd(new AdRequest.Builder().build());
  }

  private static void ensureSlotView(Activity activity, SlotState slot) {
    if (slot.viewHolder != null && slot.viewHolder.root.getParent() == overlayRoot) {
      return;
    }

    SlotViewHolder viewHolder = createSlotView(activity);
    slot.viewHolder = viewHolder;
    overlayRoot.addView(viewHolder.root);
  }

  private static void positionSlot(SlotState slot) {
    if (overlayRoot == null || slot == null || slot.viewHolder == null) {
      return;
    }

    int containerHeight = overlayRoot.getHeight();
    if (containerHeight <= 0) {
      overlayRoot.post(() -> positionSlot(slot));
      return;
    }

    Rect rect = slot.rect;
    int top = Math.max(0, containerHeight - rect.bottom);
    FrameLayout.LayoutParams params =
        new FrameLayout.LayoutParams(Math.max(1, rect.width()), Math.max(1, rect.height()));
    params.leftMargin = Math.max(0, rect.left);
    params.topMargin = top;
    slot.viewHolder.root.setLayoutParams(params);
    slot.viewHolder.root.setVisibility(slot.desiredVisible ? View.VISIBLE : View.GONE);
    slot.viewHolder.root.setAlpha(slot.desiredVisible ? 1f : MIN_VIEW_ALPHA);
  }

  private static void bindNativeAd(SlotState slot) {
    if (slot == null || slot.nativeAd == null || slot.viewHolder == null) {
      return;
    }

    SlotViewHolder holder = slot.viewHolder;
    NativeAd nativeAd = slot.nativeAd;

    setText(holder.headline, nativeAd.getHeadline(), true);
    setText(holder.cta, nativeAd.getCallToAction(), false);

    holder.root.setBodyView(null);
    holder.root.setAdvertiserView(null);
    holder.root.setStoreView(null);

    if (!TextUtils.isEmpty(nativeAd.getBody())) {
      setText(holder.supportingLine, nativeAd.getBody(), false);
      holder.root.setBodyView(holder.supportingLine);
    } else if (!TextUtils.isEmpty(nativeAd.getAdvertiser())) {
      setText(holder.supportingLine, nativeAd.getAdvertiser(), false);
      holder.root.setAdvertiserView(holder.supportingLine);
    } else if (!TextUtils.isEmpty(nativeAd.getStore())) {
      setText(holder.supportingLine, nativeAd.getStore(), false);
      holder.root.setStoreView(holder.supportingLine);
    } else {
      holder.supportingLine.setText("");
    }

    holder.cta.setVisibility(TextUtils.isEmpty(nativeAd.getCallToAction()) ? View.GONE : View.VISIBLE);
    holder.supportingLine.setVisibility(
        TextUtils.isEmpty(holder.supportingLine.getText()) ? View.GONE : View.VISIBLE);

    holder.root.setHeadlineView(holder.headline);
    holder.root.setCallToActionView(holder.cta);
    holder.root.setAdChoicesView(holder.adChoices);
    holder.root.setNativeAd(nativeAd);
    holder.root.setVisibility(slot.desiredVisible ? View.VISIBLE : View.GONE);
    holder.root.setAlpha(slot.desiredVisible ? 1f : MIN_VIEW_ALPHA);
  }

  private static SlotViewHolder createSlotView(Activity activity) {
    NativeAdView root = new NativeAdView(activity);
    root.setVisibility(View.GONE);
    root.setAlpha(MIN_VIEW_ALPHA);
    root.setClipChildren(true);
    root.setClipToPadding(true);

    GradientDrawable background = new GradientDrawable();
    background.setColor(Color.argb(214, 11, 17, 32));
    background.setCornerRadius(dp(activity, 6));
    background.setStroke(dp(activity, 1), Color.argb(190, 255, 255, 255));
    root.setBackground(background);
    root.setElevation(dp(activity, 6));

    FrameLayout shell = new FrameLayout(activity);
    shell.setLayoutParams(
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    root.addView(shell);

    LinearLayout content = new LinearLayout(activity);
    content.setOrientation(LinearLayout.HORIZONTAL);
    content.setGravity(Gravity.CENTER_VERTICAL);
    FrameLayout.LayoutParams contentParams =
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    int horizontalPadding = dp(activity, 10);
    int verticalPadding = dp(activity, 6);
    contentParams.setMargins(horizontalPadding, verticalPadding, dp(activity, 42), verticalPadding);
    shell.addView(content, contentParams);

    TextView badge = new TextView(activity);
    badge.setText("Ad");
    badge.setTextColor(Color.WHITE);
    badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
    badge.setGravity(Gravity.CENTER);
    badge.setSingleLine(true);
    badge.setPadding(dp(activity, 6), dp(activity, 2), dp(activity, 6), dp(activity, 2));
    GradientDrawable badgeBg = new GradientDrawable();
    badgeBg.setColor(Color.argb(235, 249, 115, 22));
    badgeBg.setCornerRadius(dp(activity, 999));
    badge.setBackground(badgeBg);
    LinearLayout.LayoutParams badgeParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    badgeParams.rightMargin = dp(activity, 8);
    content.addView(badge, badgeParams);

    LinearLayout textColumn = new LinearLayout(activity);
    textColumn.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams textColumnParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    content.addView(textColumn, textColumnParams);

    TextView headline = createLabel(activity, 13, true, Color.WHITE);
    headline.setMaxLines(1);
    textColumn.addView(headline);

    TextView supportingLine = createLabel(activity, 11, false, Color.argb(220, 203, 213, 225));
    supportingLine.setMaxLines(1);
    textColumn.addView(supportingLine);

    TextView cta = createLabel(activity, 11, true, Color.argb(255, 15, 23, 42));
    cta.setGravity(Gravity.CENTER);
    cta.setPadding(dp(activity, 10), dp(activity, 4), dp(activity, 10), dp(activity, 4));
    GradientDrawable ctaBg = new GradientDrawable();
    ctaBg.setColor(Color.argb(240, 255, 255, 255));
    ctaBg.setCornerRadius(dp(activity, 999));
    cta.setBackground(ctaBg);
    LinearLayout.LayoutParams ctaParams =
        new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    ctaParams.leftMargin = dp(activity, 8);
    content.addView(cta, ctaParams);

    AdChoicesView adChoices = new AdChoicesView(activity);
    FrameLayout.LayoutParams adChoicesParams =
        new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    adChoicesParams.gravity = Gravity.TOP | Gravity.END;
    adChoicesParams.topMargin = dp(activity, 4);
    adChoicesParams.rightMargin = dp(activity, 4);
    shell.addView(adChoices, adChoicesParams);

    return new SlotViewHolder(root, headline, supportingLine, cta, adChoices);
  }

  private static TextView createLabel(Activity activity, int sp, boolean bold, int color) {
    TextView view = new TextView(activity);
    view.setTextColor(color);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
    view.setSingleLine(true);
    view.setEllipsize(TextUtils.TruncateAt.END);
    if (bold) {
      view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
    }
    return view;
  }

  private static void destroyAllInternal() {
    for (SlotState slot : slots.values()) {
      destroySlot(slot);
    }
    slots.clear();

    if (overlayRoot != null) {
      ViewGroup parent = (ViewGroup) overlayRoot.getParent();
      if (parent != null) {
        parent.removeView(overlayRoot);
      }
      overlayRoot = null;
    }

    hostActivityRef = new WeakReference<>(null);
  }

  private static void destroySlot(SlotState slot) {
    if (slot == null) {
      return;
    }

    if (slot.nativeAd != null) {
      try {
        slot.nativeAd.destroy();
      } catch (Throwable ignored) {
        // no-op
      }
      slot.nativeAd = null;
    }

    if (slot.viewHolder != null) {
      try {
        ViewGroup parent = (ViewGroup) slot.viewHolder.root.getParent();
        if (parent != null) {
          parent.removeView(slot.viewHolder.root);
        }
      } catch (Throwable ignored) {
        // no-op
      }
      slot.viewHolder = null;
    }

    slot.loading = false;
    slot.desiredVisible = false;
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

  private static void setText(TextView textView, String value, boolean required) {
    String safeValue = trim(value);
    if (safeValue.isEmpty() && required) {
      safeValue = "Sponsorlu Icerik";
    }
    textView.setText(safeValue);
  }

  private static String firstNonEmpty(String... values) {
    if (values == null) {
      return "";
    }
    for (String value : values) {
      String safeValue = trim(value);
      if (!safeValue.isEmpty()) {
        return safeValue;
      }
    }
    return "";
  }

  private static int dp(Activity activity, int value) {
    return Math.round(
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            activity.getResources().getDisplayMetrics()));
  }

  private static String trim(String value) {
    return value == null ? "" : value.trim();
  }

  private static final class SlotState {
    final String slotId;
    final Rect rect = new Rect();
    boolean desiredVisible;
    boolean loading;
    long nextLoadEligibleAtMs;
    NativeAd nativeAd;
    SlotViewHolder viewHolder;

    SlotState(String slotId) {
      this.slotId = slotId;
    }
  }

  private static final class SlotViewHolder {
    final NativeAdView root;
    final TextView headline;
    final TextView supportingLine;
    final TextView cta;
    final AdChoicesView adChoices;

    SlotViewHolder(
        NativeAdView root,
        TextView headline,
        TextView supportingLine,
        TextView cta,
        AdChoicesView adChoices) {
      this.root = root;
      this.headline = headline;
      this.supportingLine = supportingLine;
      this.cta = cta;
      this.adChoices = adChoices;
    }
  }
}
