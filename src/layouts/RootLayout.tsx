import { Outlet } from 'react-router-dom';
import TopBar from '@/components/layout/TopBar';
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
      <div className="app-safe-area bg-background text-foreground">
        <HardwareBackHandler />
        <Auth />
      </div>
    );
  }

  return (
    <div className="app-safe-area bg-background text-foreground">
      <HardwareBackHandler />
      <div className="flex min-h-full flex-col bg-background">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-y-auto" data-app-scroll-container>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default RootLayout;

