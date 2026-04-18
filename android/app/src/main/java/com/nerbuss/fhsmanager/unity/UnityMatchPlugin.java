package com.nerbuss.fhsmanager.unity;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UnityMatch")
public class UnityMatchPlugin extends Plugin {

  @Override
  public void load() {
    super.load();
    UnityBridgeState.attachPlugin(this);
  }

  @Override
  protected void handleOnDestroy() {
    UnityBridgeState.detachPlugin(this);
    super.handleOnDestroy();
  }

  @PluginMethod
  public void openMatch(PluginCall call) {
    String serverIp = trim(call.getString("serverIp"));
    Integer port = call.getInt("serverPort", 7777);

    if (serverIp.isEmpty()) {
      call.reject("serverIp required");
      return;
    }

    if (port == null || port <= 0 || port > 65535) {
      call.reject("serverPort invalid");
      return;
    }

    if (getActivity() == null) {
      call.reject("activity_unavailable");
      return;
    }

    if (!UnityBridgeState.tryBeginUnityLaunch()) {
      JSObject out = new JSObject();
      out.put("ok", true);
      out.put("nativeLaunch", false);
      out.put("alreadyActive", true);
      out.put("bridgeMode", "android-capacitor-plugin");
      call.resolve(out);
      return;
    }

    Intent intent = new Intent(getActivity(), UnityHostActivity.class);
    intent.putExtra(UnityBridgeState.EXTRA_SERVER_IP, serverIp);
    intent.putExtra(UnityBridgeState.EXTRA_SERVER_PORT, port);
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_MATCH_ID, call.getString("matchId"));
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_JOIN_TICKET, call.getString("joinTicket"));
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_HOME_ID, call.getString("homeId"));
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_AWAY_ID, call.getString("awayId"));
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_MODE, call.getString("mode"));
    putExtraIfPresent(intent, UnityBridgeState.EXTRA_ROLE, call.getString("role"));

    try {
      getActivity().startActivity(intent);

      JSObject out = new JSObject();
      out.put("ok", true);
      out.put("nativeLaunch", true);
      out.put("bridgeMode", "android-capacitor-plugin");
      call.resolve(out);
    } catch (Throwable t) {
      UnityBridgeState.markUnityLaunchFailed();
      if (t instanceof Exception) {
        call.reject("unity_host_launch_failed", (Exception) t);
      } else {
        call.reject("unity_host_launch_failed", String.valueOf(t.getMessage()));
      }
    }
  }

  @PluginMethod
  public void closeMatch(PluginCall call) {
    boolean closed =
        UnityBridgeState.requestReturnToMainShell(
            "UnityMatchPlugin.closeMatch", null, null, (Integer) null);
    if (!closed) {
      closed = UnityBridgeState.requestCloseActiveUnityHost();
    }
    JSObject out = new JSObject();
    out.put("ok", true);
    out.put("requested", closed);
    call.resolve(out);
  }

  @PluginMethod
  public void getLaunchStatus(PluginCall call) {
    call.resolve(UnityBridgeState.snapshotLaunchStatus());
  }

  void dispatchUnityEvent(JSObject event) {
    if (event == null) {
      return;
    }

    if (getActivity() != null) {
      getActivity().runOnUiThread(() -> notifyListeners("unityEvent", event, true));
      return;
    }

    notifyListeners("unityEvent", event, true);
  }

  private static void putExtraIfPresent(Intent intent, String key, String value) {
    String trimmed = trim(value);
    if (!trimmed.isEmpty()) {
      intent.putExtra(key, trimmed);
    }
  }

  private static String trim(String raw) {
    return raw == null ? "" : raw.trim();
  }
}
