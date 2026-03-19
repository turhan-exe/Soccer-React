import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '@/contexts/AuthContext';
import { heartbeatMatchControlPresence, isMatchControlConfigured } from '@/services/matchControl';

const HEARTBEAT_INTERVAL_MS = 15_000;

const MatchControlPresenceHeartbeat = () => {
  const { user, isAuthReady } = useAuth();
  const isForegroundRef = useRef(true);

  useEffect(() => {
    if (!isAuthReady || !user?.id || !isMatchControlConfigured()) {
      return;
    }

    let disposed = false;
    let timerId: number | null = null;
    let appStateListenerPromise: Promise<{ remove: () => Promise<void> }> | null = null;

    const canSendHeartbeat = () => {
      if (disposed) return false;
      if (!isForegroundRef.current) return false;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return false;
      }
      return true;
    };

    const scheduleNext = () => {
      if (disposed) return;
      timerId = window.setTimeout(() => {
        void sendHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
    };

    const sendHeartbeat = async () => {
      if (!canSendHeartbeat()) {
        scheduleNext();
        return;
      }

      try {
        await heartbeatMatchControlPresence(user.id);
      } catch (error) {
        console.warn('[MatchControlPresenceHeartbeat] heartbeat failed', error);
      } finally {
        scheduleNext();
      }
    };

    const handleVisibilityOrFocus = () => {
      if (!canSendHeartbeat()) {
        return;
      }
      if (timerId != null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      void sendHeartbeat();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    if (Capacitor.isNativePlatform()) {
      appStateListenerPromise = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        isForegroundRef.current = Boolean(isActive);
        if (isActive) {
          handleVisibilityOrFocus();
        }
      });
    }

    void sendHeartbeat();

    return () => {
      disposed = true;
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
      if (appStateListenerPromise) {
        void appStateListenerPromise.then((listener) => listener.remove());
      }
    };
  }, [isAuthReady, user?.id]);

  return null;
};

export default MatchControlPresenceHeartbeat;
