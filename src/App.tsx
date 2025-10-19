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

const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    const lockOrientation = async () => {
      const { orientation } = window.screen ?? {};
      if (orientation && typeof (orientation as any).lock === 'function') {
        try {
          await (orientation as any).lock('landscape');
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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <DiamondProvider>
            <InventoryProvider>
              <TooltipProvider>
                <Toaster />
               <RouterProvider router={router} fallbackElement={<div>Yükleniyor…</div>} />
              </TooltipProvider>
            </InventoryProvider>
          </DiamondProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
