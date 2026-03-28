package com.nerbuss.fhsmanager.unity;

import android.app.Activity;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.nerbuss.fhsmanager.MainActivity;
import java.lang.ref.WeakReference;
import java.util.ArrayDeque;
import java.util.Queue;

public final class UnityBridgeState {
  private static final String TAG = "UnityBridgeState";
  static final String EXTRA_SERVER_IP = "fhs_server_ip";
  static final String EXTRA_SERVER_PORT = "fhs_server_port";
  static final String EXTRA_MATCH_ID = "fhs_match_id";
  static final String EXTRA_JOIN_TICKET = "fhs_join_ticket";
  static final String EXTRA_HOME_ID = "fhs_home_id";
  static final String EXTRA_AWAY_ID = "fhs_away_id";
  static final String EXTRA_MODE = "fhs_mode";
  static final String EXTRA_ROLE = "fhs_role";

  private static final Object LOCK = new Object();
  private static final Handler MAIN = new Handler(Looper.getMainLooper());
  private static WeakReference<UnityMatchPlugin> pluginRef = new WeakReference<>(null);
  private static WeakReference<Activity> activeUnityHostRef = new WeakReference<>(null);
  private static final Queue<JSObject> pendingEvents = new ArrayDeque<>();
  private static boolean pendingShellReturn;
  private static boolean unityLaunchInFlight;

  private UnityBridgeState() {}

  static void attachPlugin(UnityMatchPlugin plugin) {
    synchronized (LOCK) {
      pluginRef = new WeakReference<>(plugin);
    }
    flushPendingEvents();
  }

  static void detachPlugin(UnityMatchPlugin plugin) {
    synchronized (LOCK) {
      UnityMatchPlugin current = pluginRef.get();
      if (current == plugin) {
        pluginRef = new WeakReference<>(null);
      }
    }
  }

  static void setActiveUnityHost(Activity activity) {
    synchronized (LOCK) {
      unityLaunchInFlight = false;
      activeUnityHostRef = new WeakReference<>(activity);
    }
  }

  static void clearActiveUnityHost(Activity activity) {
    synchronized (LOCK) {
      Activity current = activeUnityHostRef.get();
      if (current == activity) {
        activeUnityHostRef = new WeakReference<>(null);
      }

      unityLaunchInFlight = false;
    }
  }

  static boolean isUnityLaunchActiveOrInFlight() {
    synchronized (LOCK) {
      Activity activeHost = activeUnityHostRef.get();
      if (unityLaunchInFlight || activeHost != null) {
        return true;
      }
    }

    return isUnityActivity(resolveCurrentUnityActivity());
  }

  static boolean tryBeginUnityLaunch() {
    Activity currentUnityActivity = resolveCurrentUnityActivity();

    synchronized (LOCK) {
      Activity activeHost = activeUnityHostRef.get();
      if (unityLaunchInFlight || activeHost != null || isUnityActivity(currentUnityActivity)) {
        return false;
      }

      unityLaunchInFlight = true;
      return true;
    }
  }

  static void markUnityLaunchFailed() {
    synchronized (LOCK) {
      unityLaunchInFlight = false;
    }
  }

  public static boolean requestCloseActiveUnityHost() {
    final Activity activity;
    synchronized (LOCK) {
      activity = activeUnityHostRef.get();
    }

    if (activity == null) {
      return false;
    }

    MAIN.post(
        () -> {
          try {
            Log.d(TAG, "requestCloseActiveUnityHost: finishing active unity host.");
            activity.finish();
          } catch (Throwable ignored) {
            // no-op
          }
        });

    return true;
  }

  public static boolean requestReturnToMainShell(
      String reason, String matchId, String serverIp, int serverPort) {
    return requestReturnToMainShellInternal(reason, matchId, serverIp, Integer.valueOf(serverPort));
  }

  public static boolean requestReturnToMainShell(
      String reason, String matchId, String serverIp, Integer serverPort) {
    return requestReturnToMainShellInternal(reason, matchId, serverIp, serverPort);
  }

  private static boolean requestReturnToMainShellInternal(
      String reason, String matchId, String serverIp, Integer serverPort) {
    final Activity hostActivity;
    synchronized (LOCK) {
      hostActivity = activeUnityHostRef.get();
      pendingShellReturn = true;
    }

    final Activity currentUnityActivity = resolveCurrentUnityActivity();
    if (currentUnityActivity == null && hostActivity == null) {
      return false;
    }

    MAIN.post(
        () -> {
          emit(
              "closed",
              reason == null || reason.isEmpty() ? "Unity requested return to shell." : reason,
              matchId,
              serverIp,
              serverPort);

          try {
            if (currentUnityActivity != null && currentUnityActivity != hostActivity) {
              if (tryRequestEmbeddedUnityShellReturn(currentUnityActivity)) {
                Log.d(
                    TAG,
                    "requestReturnToMainShell: requesting embedded Unity child unload for shell return.");
              } else {
                Log.d(
                    TAG,
                    "requestReturnToMainShell: finishing current Unity child activity and letting host return to shell.");
                finishActivitySafely(currentUnityActivity);
              }
              return;
            }
          } catch (Throwable ignored) {
            // no-op
          }

          try {
            Activity shellSource = hostActivity != null ? hostActivity : currentUnityActivity;
            if (shellSource != null) {
              bringShellToFront(shellSource);
            }

            if (hostActivity != null) {
              Log.d(TAG, "requestReturnToMainShell: finishing Unity host activity for shell return.");
              finishActivitySafely(hostActivity);
            }
          } catch (Throwable ignored) {
            // no-op
          }
        });

    return true;
  }

  private static void bringShellToFront(Activity source) {
    if (source == null) {
      return;
    }

    try {
      Intent shellIntent = new Intent(source, MainActivity.class);
      shellIntent.addFlags(
          Intent.FLAG_ACTIVITY_CLEAR_TOP
              | Intent.FLAG_ACTIVITY_SINGLE_TOP
              | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
              | Intent.FLAG_ACTIVITY_NEW_TASK);
      shellIntent.putExtra("unity_force_shell_return", true);
      source.startActivity(shellIntent);
    } catch (Throwable t) {
      Log.w(TAG, "bringShellToFront failed.", t);
    }
  }

  private static Activity resolveCurrentUnityActivity() {
    try {
      Class<?> unityPlayerClass = Class.forName("com.unity3d.player.UnityPlayer");
      Object currentActivity = unityPlayerClass.getField("currentActivity").get(null);
      if (currentActivity instanceof Activity) {
        return (Activity) currentActivity;
      }
    } catch (Throwable ignored) {
      // no-op
    }

    return null;
  }

  private static boolean isUnityActivity(Activity activity) {
    if (activity == null) {
      return false;
    }

    String className = activity.getClass().getName();
    return className != null && className.startsWith("com.unity3d.player.");
  }

  private static boolean tryRequestEmbeddedUnityShellReturn(Activity activity) {
    if (activity == null) {
      return false;
    }

    try {
      activity.getClass().getMethod("requestReturnToShell").invoke(activity);
      return true;
    } catch (Throwable ignored) {
      return false;
    }
  }

  private static void finishActivitySafely(Activity activity) {
    if (activity == null) {
      return;
    }

    try {
      activity.setResult(Activity.RESULT_OK);
    } catch (Throwable ignored) {
      // no-op
    }

    try {
      activity.finish();
    } catch (Throwable ignored) {
      // no-op
    }
  }

  public static boolean consumePendingShellReturn() {
    synchronized (LOCK) {
      if (!pendingShellReturn) {
        return false;
      }

      pendingShellReturn = false;
      return true;
    }
  }

  static void emit(String type) {
    emit(type, null, null, null, null);
  }

  static void emit(String type, String message) {
    emit(type, message, null, null, null);
  }

  static void emit(
      String type, String message, String matchId, String serverIp, Integer serverPort) {
    JSObject event = new JSObject();
    event.put("type", type == null ? "unknown" : type);
    if (message != null && !message.isEmpty()) {
      event.put("message", message);
    }
    if (matchId != null && !matchId.isEmpty()) {
      event.put("matchId", matchId);
    }
    if (serverIp != null && !serverIp.isEmpty()) {
      event.put("serverIp", serverIp);
    }
    if (serverPort != null) {
      event.put("serverPort", serverPort);
    }

    UnityMatchPlugin plugin;
    synchronized (LOCK) {
      plugin = pluginRef.get();
      if (plugin == null) {
        pendingEvents.add(event);
        return;
      }
    }

    plugin.dispatchUnityEvent(event);
  }

  private static void flushPendingEvents() {
    final UnityMatchPlugin plugin;
    synchronized (LOCK) {
      plugin = pluginRef.get();
      if (plugin == null || pendingEvents.isEmpty()) {
        return;
      }
    }

    while (true) {
      JSObject event;
      synchronized (LOCK) {
        event = pendingEvents.poll();
      }
      if (event == null) {
        break;
      }
      plugin.dispatchUnityEvent(event);
    }
  }
}
