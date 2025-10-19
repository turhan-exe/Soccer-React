import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { toast } from 'sonner';

const EXIT_THRESHOLD_MS = 1500;

const HardwareBackHandler = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const lastBackPressRef = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    lastBackPressRef.current = 0;

    const removeListener = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const historyCanGoBack = window.history.length > 1;
      if (canGoBack || historyCanGoBack) {
        navigate(-1);
        return;
      }

      const now = Date.now();
      if (now - lastBackPressRef.current <= EXIT_THRESHOLD_MS) {
        CapacitorApp.exitApp().catch(() => {
          // Fallback: if exitApp fails, reset timestamp so user can try again
          lastBackPressRef.current = 0;
        });
      } else {
        lastBackPressRef.current = now;
        toast.info('Çıkmak için geri tuşuna tekrar basın');
      }
    });

    return () => {
      removeListener.remove();
    };
  }, [navigate, location]);

  return null;
};

export default HardwareBackHandler;
