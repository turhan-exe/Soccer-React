package com.nerbuss.fhsmanager.unity;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.lang.ref.WeakReference;
import java.util.ArrayDeque;
import java.util.Queue;

public final class UnityBridgeState {
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
      activeUnityHostRef = new WeakReference<>(activity);
    }
  }

  static void clearActiveUnityHost(Activity activity) {
    synchronized (LOCK) {
      Activity current = activeUnityHostRef.get();
      if (current == activity) {
        activeUnityHostRef = new WeakReference<>(null);
      }
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
            activity.finish();
          } catch (Throwable ignored) {
            // no-op
          }
        });

    return true;
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
