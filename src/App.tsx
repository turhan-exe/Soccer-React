import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { DiamondProvider } from '@/contexts/DiamondContext';
import { router } from '@/routes/router';
import { InventoryProvider } from '@/contexts/InventoryContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { unityBridge } from '@/services/unityBridge';
import { initializeRewardedAds, isRewardedAdsSupported } from '@/services/rewardedAds';
import { markBootVisualReadyOnce } from '@/services/uiState';
import { markStartupTiming } from '@/services/startupTiming';
import ForceUpdateGate from '@/components/system/ForceUpdateGate';
import MatchControlPresenceHeartbeat from '@/components/system/MatchControlPresenceHeartbeat';
import PushNotificationsBootstrap from '@/components/system/PushNotificationsBootstrap';
import KeyboardViewportManager from '@/components/system/KeyboardViewportManager';
import { useAuth } from '@/contexts/AuthContext';

const queryClient = new QueryClient();
const BOOT_SHELL_REVEAL_DELAY_MS = 0;
const DEFERRED_BOOT_SERVICES_DELAY_MS = 1600;

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

const NativeStartupVisualController = () => {
  const { isAuthReady } = useAuth();
  const [isBootVisualReleased, setIsBootVisualReleased] = useState(!Capacitor.isNativePlatform());

  useEffect(() => {
    if (isAuthReady) {
      markStartupTiming('auth_ready');
    }
  }, [isAuthReady]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || isBootVisualReleased) {
      return;
    }

    let rafA = 0;
    let rafB = 0;
    let timeoutId = 0;

    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(() => {
        timeoutId = window.setTimeout(() => {
          markStartupTiming('shell_ready');
          void markBootVisualReadyOnce().finally(() => {
            markStartupTiming('boot_visual_ready_marked');
          });
          SplashScreen.hide({ fadeOutDuration: 120 })
            .catch(() => undefined)
            .finally(() => {
              markStartupTiming('native_splash_hidden');
              setIsBootVisualReleased(true);
            });
        }, BOOT_SHELL_REVEAL_DELAY_MS);
      });
    });

    return () => {
      window.cancelAnimationFrame(rafA);
      window.cancelAnimationFrame(rafB);
      window.clearTimeout(timeoutId);
    };
  }, [isAuthReady, isBootVisualReleased]);

  return null;
};

const DeferredBootServices = () => {
  const { isAuthReady } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isAuthReady || enabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      markStartupTiming('deferred_services_enabled');
      setEnabled(true);
    }, DEFERRED_BOOT_SERVICES_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [enabled, isAuthReady]);

  useEffect(() => {
    if (!enabled || !isRewardedAdsSupported()) {
      return;
    }

    void initializeRewardedAds().catch((error) => {
      console.warn('[App] Rewarded ads initialization failed', error);
    });
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      <MatchControlPresenceHeartbeat />
      <PushNotificationsBootstrap />
    </>
  );
};

const App = () => {
  useEffect(() => {
    markStartupTiming('react_app_mounted');
  }, []);

  useEffect(() => {
    const lockOrientation = async () => {
      const orientation = window.screen?.orientation as ScreenOrientationWithLock | undefined;
      if (orientation && typeof orientation.lock === 'function') {
        try {
          await orientation.lock('landscape');
        } catch {
          // Some browsers require user interaction before locking orientation
        }
      }
    };

    const handleResize = () => {
      void lockOrientation();
    };

    lockOrientation();

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let removeUnityListener: (() => Promise<void>) | null = null;

    const navigateShellHome = () => {
      if (disposed) {
        return;
      }

      void router.navigate('/', { replace: true });
    };

    const handleNativeShellReturn = () => {
      navigateShellHome();
    };

    window.addEventListener('nativeUnityShellReturn', handleNativeShellReturn as EventListener);

    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      void unityBridge
        .onUnityEvent((event) => {
          const type = String(event?.type || '').trim().toLowerCase();
          const reason = String(event?.reason || event?.message || '').trim().toLowerCase();
          if (type === 'closed' && reason.includes('manual_launch_force_close_stale_host')) {
            return;
          }
          if (type === 'closed' || type === 'connection_failed' || type === 'error') {
            navigateShellHome();
          }
        })
        .then((remove) => {
          removeUnityListener = remove;
        })
        .catch((error) => {
          console.warn('[App] Unity global listener registration failed', error);
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener('nativeUnityShellReturn', handleNativeShellReturn as EventListener);
      if (removeUnityListener) {
        void removeUnityListener();
      }
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <ForceUpdateGate>
            <AuthProvider>
              <KeyboardViewportManager />
              <NativeStartupVisualController />
              <DeferredBootServices />
              <DiamondProvider>
                <InventoryProvider>
                  <TooltipProvider>
                    <Toaster />
                    <RouterProvider router={router} future={{ v7_startTransition: true }} />
                  </TooltipProvider>
                </InventoryProvider>
              </DiamondProvider>
            </AuthProvider>
          </ForceUpdateGate>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
};

export default App;
