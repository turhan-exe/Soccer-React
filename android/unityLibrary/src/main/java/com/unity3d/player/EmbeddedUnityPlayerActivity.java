package com.unity3d.player;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Unity player activity wrapper for embedded mode.
 * Prevents app backgrounding on unload/quit.
 */
public class EmbeddedUnityPlayerActivity extends UnityPlayerActivity {
    private static final String TAG = "EmbeddedUnityPlayer";
    private static final long SHELL_RETURN_FALLBACK_MS = 1800L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable shellReturnFallback =
            new Runnable() {
                @Override
                public void run() {
                    if (!shellReturnRequested || finishRequested || isFinishing()) {
                        return;
                    }

                    Log.w(TAG, "requestReturnToShell: unload callback timeout, forcing finish.");
                    finishForShellReturn();
                }
            };

    private boolean shellReturnRequested;
    private boolean skipDestroyOnDestroy;
    private boolean finishRequested;

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
            skipDestroyOnDestroy = true;
            skipDestroyOnDestroy = true;
            skipDestroyOnDestroy = true;
            skipDestroyOnDestroy = true;
            skipDestroyOnDestroy = true;


            scheduleShellReturnFallback();

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
        cancelShellReturnFallback();
        finishForShellReturn();
    }

    @Override
    public void onUnityPlayerQuitted() {
        Log.d(TAG, "onUnityPlayerQuitted: finishing embedded activity for shell return.");
        skipDestroyOnDestroy = shellReturnRequested || skipDestroyOnDestroy;
        cancelShellReturnFallback();
        finishForShellReturn();
    }

    @Override
    protected void onDestroy() {
        cancelShellReturnFallback();
        if (shellReturnRequested) {
            skipDestroyOnDestroy = true;
        }

        super.onDestroy();
    }

    private void finishForShellReturn() {
        if (finishRequested || isFinishing()) {
            return;
        }

        cancelShellReturnFallback();
        finishRequested = true;
        try {
            setResult(Activity.RESULT_OK);
        } catch (Throwable ignored) {
            // no-op
        }

        finish();
    }

    private void scheduleShellReturnFallback() {
        cancelShellReturnFallback();
        mainHandler.postDelayed(shellReturnFallback, SHELL_RETURN_FALLBACK_MS);
    }

    private void cancelShellReturnFallback() {
        mainHandler.removeCallbacks(shellReturnFallback);
    }
}
