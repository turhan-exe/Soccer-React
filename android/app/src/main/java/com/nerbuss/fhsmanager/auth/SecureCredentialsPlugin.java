package com.nerbuss.fhsmanager.auth;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecureCredentials")
public class SecureCredentialsPlugin extends Plugin {
  private static final String TAG = "SecureCredentials";
  private static final String STORE_NAME = "secure_credentials_store";
  private static final String VALUE_KEY = "remembered_credentials";

  private SharedPreferences sharedPreferences;

  @Override
  public void load() {
    super.load();

    try {
      Context context = getContext();
      MasterKey masterKey =
          new MasterKey.Builder(context)
              .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
              .build();

      sharedPreferences =
          EncryptedSharedPreferences.create(
              context,
              STORE_NAME,
              masterKey,
              EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
              EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
    } catch (Exception error) {
      sharedPreferences = null;
      Log.e(TAG, "Unable to initialize secure credential storage", error);
    }
  }

  @PluginMethod
  public void get(PluginCall call) {
    JSObject result = new JSObject();
    result.put("value", getPreferencesValue());
    call.resolve(result);
  }

  @PluginMethod
  public void set(PluginCall call) {
    String value = call.getString("value");
    if (value == null) {
      call.reject("missing_value");
      return;
    }

    SharedPreferences preferences = requirePreferences(call);
    if (preferences == null) {
      return;
    }

    preferences.edit().putString(VALUE_KEY, value).apply();
    call.resolve();
  }

  @PluginMethod
  public void clear(PluginCall call) {
    SharedPreferences preferences = requirePreferences(call);
    if (preferences == null) {
      return;
    }

    preferences.edit().remove(VALUE_KEY).apply();
    call.resolve();
  }

  private String getPreferencesValue() {
    return sharedPreferences == null ? null : sharedPreferences.getString(VALUE_KEY, null);
  }

  private SharedPreferences requirePreferences(PluginCall call) {
    if (sharedPreferences != null) {
      return sharedPreferences;
    }

    call.reject("secure_storage_unavailable");
    return null;
  }
}
