package com.nerbuss.fhsmanager.ui;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.nerbuss.fhsmanager.MainActivity;

@CapacitorPlugin(name = "UiState")
public class UiStatePlugin extends Plugin {
  @PluginMethod
  public void markBootVisualReady(PluginCall call) {
    if (getActivity() instanceof MainActivity) {
      ((MainActivity) getActivity()).markBootVisualReady();
    }
    call.resolve();
  }
}
