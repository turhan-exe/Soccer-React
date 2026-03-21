import { Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import Auth from '@/pages/Auth';
import HardwareBackHandler from '@/components/system/HardwareBackHandler';

const RootLayout = () => {
  const { user, isAuthReady } = useAuth();

  if (!isAuthReady) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Oturum yukleniyor...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-safe-area">
        <HardwareBackHandler />
        <div className="min-h-full bg-background text-foreground">
          <Auth />
        </div>
      </div>
    );
  }

  return (
    <div className="app-safe-area">
      <HardwareBackHandler />
      <div className="flex min-h-full flex-col bg-background text-foreground">
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" data-app-scroll-container data-keyboard-scroll-container>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default RootLayout;

