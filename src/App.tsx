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
import ForceUpdateGate from '@/components/system/ForceUpdateGate';
import MatchControlPresenceHeartbeat from '@/components/system/MatchControlPresenceHeartbeat';
import PushNotificationsBootstrap from '@/components/system/PushNotificationsBootstrap';
import KeyboardViewportManager from '@/components/system/KeyboardViewportManager';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/contexts/InventoryContext';

const queryClient = new QueryClient();
const BOOT_UI_STABILIZATION_MS = 1000;

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

const NativeStartupSplashController = () => {
  const { isAuthReady } = useAuth();
  const { isHydrated } = useInventory();
  const [isSplashHidden, setIsSplashHidden] = useState(!Capacitor.isNativePlatform());

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || isSplashHidden) {
      return;
    }

    if (!isAuthReady || !isHydrated) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      SplashScreen.hide({ fadeOutDuration: 200 })
        .catch(() => undefined)
        .finally(() => {
          setIsSplashHidden(true);
        });
    }, BOOT_UI_STABILIZATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAuthReady, isHydrated, isSplashHidden]);

  return null;
};

const App = () => {
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

  useEffect(() => {
    if (!isRewardedAdsSupported()) {
      return;
    }

    void initializeRewardedAds().catch((error) => {
      console.warn('[App] Rewarded ads initialization failed', error);
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <ForceUpdateGate>
            <AuthProvider>
              <KeyboardViewportManager />
              <MatchControlPresenceHeartbeat />
              <PushNotificationsBootstrap />
              <DiamondProvider>
                <InventoryProvider>
                  <NativeStartupSplashController />
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
