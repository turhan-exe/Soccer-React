package com.unity3d.player;

import android.app.Activity;
import android.util.Log;

/**
 * Unity player activity wrapper for embedded mode.
 * Prevents app backgrounding on unload/quit.
 */
public class EmbeddedUnityPlayerActivity extends UnityPlayerActivity {
    private static final String TAG = "EmbeddedUnityPlayer";
    private boolean shellReturnRequested;
    private boolean skipDestroyOnDestroy;

    @Override
    protected boolean shouldDestroyUnityPlayerOnDestroy() {
        return !skipDestroyOnDestroy;
    }

    public void requestReturnToShell() {
        runOnUiThread(() -> {
            if (shellReturnRequested) {
                return;
            }

            shellReturnRequested = true;

            try {
                if (mUnityPlayer != null) {
                    Log.d(TAG, "requestReturnToShell: unloading Unity player for shell return.");
                    mUnityPlayer.unload();
                    return;
                }
            } catch (Throwable unloadError) {
                Log.w(TAG, "requestReturnToShell: unload failed, falling back to finish.", unloadError);
            }

            finishForShellReturn();
        });
    }

    @Override
    public void onUnityPlayerUnloaded() {
        Log.d(TAG, "onUnityPlayerUnloaded: finishing embedded activity for shell return.");
        skipDestroyOnDestroy = true;
        finishForShellReturn();
    }

    @Override
    public void onUnityPlayerQuitted() {
        Log.d(TAG, "onUnityPlayerQuitted: finishing embedded activity for shell return.");
        skipDestroyOnDestroy = false;
        finishForShellReturn();
    }

    private void finishForShellReturn() {
        try {
            setResult(Activity.RESULT_OK);
        } catch (Throwable ignored) {
            // no-op
        }

        finish();
    }
}
