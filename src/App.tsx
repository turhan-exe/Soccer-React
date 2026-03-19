import { useEffect } from 'react';
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
import { unityBridge } from '@/services/unityBridge';
import MatchControlPresenceHeartbeat from '@/components/system/MatchControlPresenceHeartbeat';

const queryClient = new QueryClient();

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
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

    const updateViewportHeight = () => {
      document.documentElement.style.setProperty('--app-viewport-height', `${window.innerHeight}px`);
    };

    const handleResize = () => {
      updateViewportHeight();
      void lockOrientation();
    };

    lockOrientation();
    updateViewportHeight();

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize);

    if (Capacitor.isNativePlatform()) {
      SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => undefined);
    }

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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <MatchControlPresenceHeartbeat />
          <DiamondProvider>
            <InventoryProvider>
              <TooltipProvider>
                <Toaster />
                <RouterProvider router={router} future={{ v7_startTransition: true }} />
              </TooltipProvider>
            </InventoryProvider>
          </DiamondProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
