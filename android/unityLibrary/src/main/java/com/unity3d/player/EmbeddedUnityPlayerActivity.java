package com.unity3d.player;

/**
 * Unity player activity wrapper for embedded mode.
 * Prevents app backgrounding on unload/quit.
 */
public class EmbeddedUnityPlayerActivity extends UnityPlayerActivity {
    @Override
    public void onUnityPlayerUnloaded() {
        finish();
    }

    @Override
    public void onUnityPlayerQuitted() {
        finish();
    }
}
