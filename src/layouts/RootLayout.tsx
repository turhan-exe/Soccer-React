import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import TopBar from '@/components/layout/TopBar';
import { useAuth } from '@/contexts/AuthContext';
import Auth from '@/pages/Auth';
import HardwareBackHandler from '@/components/system/HardwareBackHandler';

const RootLayout = () => {
  const { user, isAuthReady } = useAuth();
  const [isTopBarVisible, setIsTopBarVisible] = useState(false);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const node = mainScrollRef.current;
    if (!node) {
      return;
    }

    let rafId = 0;
    const handleScroll = () => {
      if (rafId) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        const current = node.scrollTop;
        const last = lastScrollTopRef.current;
        const delta = current - last;

        if (delta < -3) {
          setIsTopBarVisible(true);
        } else if (delta > 3 || current > 12) {
          setIsTopBarVisible(true);
        }

        lastScrollTopRef.current = current;
        rafId = 0;
      });
    };

    node.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      node.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleDismissTopBar = () => {
    setIsTopBarVisible(false);
  };

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
        <TopBar isVisible={isTopBarVisible} onDismiss={handleDismissTopBar} />
        <main ref={mainScrollRef} className="app-scroll-region flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default RootLayout;

