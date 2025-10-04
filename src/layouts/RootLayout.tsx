import { Outlet } from 'react-router-dom';
import TopBar from '@/components/layout/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import Auth from '@/pages/Auth';

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
    return <Auth />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopBar />
      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default RootLayout;
