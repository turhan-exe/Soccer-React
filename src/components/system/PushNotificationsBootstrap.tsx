import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  clearNativePushRegistration,
  initializePushNotifications,
  registerPushForegroundSync,
  syncNativePushRegistration,
} from '@/services/pushNotifications';

export default function PushNotificationsBootstrap() {
  const { user, isAuthReady } = useAuth();

  useEffect(() => {
    void initializePushNotifications();
    return registerPushForegroundSync();
  }, []);

  useEffect(() => {
    if (!isAuthReady) {
      return;
    }

    if (!user?.id) {
      void clearNativePushRegistration();
      return;
    }

    const enabled = user.notificationPrefs?.pushEnabled !== false;
    void syncNativePushRegistration(user.id, enabled);
  }, [isAuthReady, user?.id, user?.notificationPrefs?.pushEnabled]);

  return null;
}
