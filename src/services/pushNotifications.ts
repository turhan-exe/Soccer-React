import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  FirebaseMessaging,
  type NotificationActionPerformedEvent,
  type NotificationReceivedEvent,
  Importance,
  Visibility,
} from '@capacitor-firebase/messaging';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { router } from '@/routes/router';

const INSTALLATION_ID_KEY = 'fm_push_installation_id_v1';
const LAST_REGISTERED_UID_KEY = 'fm_push_last_uid_v1';
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev';
const PUSH_CHANNEL_ID = 'fhs-events';

type PushData = Record<string, unknown> & {
  path?: string;
  type?: string;
};

type PushContext = {
  uid: string | null;
  pushEnabled: boolean;
};

let listenersReady = false;
let currentContext: PushContext = { uid: null, pushEnabled: true };

const isNativePushPlatform = () => Capacitor.isNativePlatform();

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // no-op
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  },
};

const getInstallationId = () => {
  const existing = storage.get(INSTALLATION_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `install-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  storage.set(INSTALLATION_ID_KEY, generated);
  return generated;
};

const getLastRegisteredUid = () => storage.get(LAST_REGISTERED_UID_KEY);

const setLastRegisteredUid = (uid: string | null) => {
  if (uid) {
    storage.set(LAST_REGISTERED_UID_KEY, uid);
    return;
  }
  storage.remove(LAST_REGISTERED_UID_KEY);
};

const currentDeviceRef = (uid: string) => doc(db, 'users', uid, 'devices', getInstallationId());

const getNotificationPath = (data: PushData | null | undefined) => {
  if (!data) {
    return '/';
  }

  if (typeof data.path === 'string' && data.path.trim()) {
    return data.path.trim();
  }

  switch (String(data.type || '').trim()) {
    case 'youth-ready':
      return '/youth';
    case 'academy-ready':
      return '/academy';
    case 'training-complete':
      return '/training';
    case 'league-match-1m':
    case 'league-match-2m':
      return '/fixtures';
    default:
      return '/';
  }
};

const handleNotificationRoute = async (data: PushData | null | undefined) => {
  const path = getNotificationPath(data);
  if (!path) {
    return;
  }
  await router.navigate(path);
};

const upsertDeviceRegistration = async (
  uid: string,
  token: string,
  pushEnabled: boolean,
) => {
  await setDoc(
    currentDeviceRef(uid),
    {
      installationId: getInstallationId(),
      platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
      fcmToken: token,
      appVersion: APP_VERSION,
      pushEnabled,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  setLastRegisteredUid(uid);
};

const detachPreviousUserIfNeeded = async (uid: string | null) => {
  const lastUid = getLastRegisteredUid();
  if (!lastUid || lastUid === uid) {
    return;
  }

  try {
    await deleteDoc(currentDeviceRef(lastUid));
  } catch (error) {
    console.warn('[pushNotifications] Failed to detach previous user device', error);
  } finally {
    setLastRegisteredUid(uid);
  }
};

const ensureAndroidChannel = async () => {
  if (Capacitor.getPlatform() !== 'android') {
    return;
  }

  await FirebaseMessaging.createChannel({
    id: PUSH_CHANNEL_ID,
    name: 'FHS Events',
    description: 'Mac, altyapi ve antrenman bildirimleri',
    importance: Importance.High,
    visibility: Visibility.Public,
    vibration: true,
    lights: true,
  }).catch(() => undefined);
};

const handleForegroundNotification = async (event: NotificationReceivedEvent) => {
  const data = (event.notification?.data || null) as PushData | null;
  if (document.visibilityState === 'visible') {
    return;
  }
  await handleNotificationRoute(data);
};

const handleNotificationAction = async (event: NotificationActionPerformedEvent) => {
  const data = (event.notification?.data || null) as PushData | null;
  await handleNotificationRoute(data);
};

export const initializePushNotifications = async () => {
  if (!isNativePushPlatform() || listenersReady) {
    return;
  }

  const support = await FirebaseMessaging.isSupported().catch(() => ({ isSupported: false }));
  if (!support.isSupported) {
    return;
  }

  await ensureAndroidChannel();

  await FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
    const uid = currentContext.uid;
    if (!uid || !currentContext.pushEnabled || !token) {
      return;
    }
    try {
      await upsertDeviceRegistration(uid, token, true);
    } catch (error) {
      console.warn('[pushNotifications] tokenReceived sync failed', error);
    }
  });

  await FirebaseMessaging.addListener('notificationReceived', async (event) => {
    try {
      await handleForegroundNotification(event);
    } catch (error) {
      console.warn('[pushNotifications] notificationReceived handling failed', error);
    }
  });

  await FirebaseMessaging.addListener('notificationActionPerformed', async (event) => {
    try {
      await handleNotificationAction(event);
    } catch (error) {
      console.warn('[pushNotifications] notificationActionPerformed handling failed', error);
    }
  });

  listenersReady = true;
};

export const syncNativePushRegistration = async (
  uid: string,
  pushEnabled: boolean,
) => {
  if (!isNativePushPlatform()) {
    return false;
  }

  currentContext = { uid, pushEnabled };
  await initializePushNotifications();
  await detachPreviousUserIfNeeded(uid);

  if (!pushEnabled) {
    await setDoc(
      currentDeviceRef(uid),
      {
        installationId: getInstallationId(),
        platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
        appVersion: APP_VERSION,
        pushEnabled: false,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setLastRegisteredUid(uid);
    return false;
  }

  const permission = await FirebaseMessaging.checkPermissions();
  const receive =
    permission.receive === 'granted'
      ? permission.receive
      : (await FirebaseMessaging.requestPermissions()).receive;

  if (receive !== 'granted') {
    await setDoc(
      currentDeviceRef(uid),
      {
        installationId: getInstallationId(),
        platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
        appVersion: APP_VERSION,
        pushEnabled: false,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setLastRegisteredUid(uid);
    return false;
  }

  await ensureAndroidChannel();
  const { token } = await FirebaseMessaging.getToken();
  if (!token) {
    return false;
  }

  await upsertDeviceRegistration(uid, token, true);
  return true;
};

export const clearNativePushRegistration = async () => {
  if (!isNativePushPlatform()) {
    return;
  }

  const lastUid = getLastRegisteredUid();
  currentContext = { uid: null, pushEnabled: true };

  if (lastUid) {
    try {
      await deleteDoc(currentDeviceRef(lastUid));
    } catch (error) {
      console.warn('[pushNotifications] Failed to delete device registration on logout', error);
    }
  }

  try {
    await FirebaseMessaging.deleteToken();
  } catch (error) {
    console.warn('[pushNotifications] deleteToken failed', error);
  }

  setLastRegisteredUid(null);
};

export const setNativePushPreference = async (uid: string, pushEnabled: boolean) => {
  currentContext = { uid, pushEnabled };
  if (pushEnabled) {
    await syncNativePushRegistration(uid, true);
    return;
  }

  await setDoc(
    currentDeviceRef(uid),
    {
      installationId: getInstallationId(),
      platform: Capacitor.getPlatform() === 'ios' ? 'ios' : 'android',
      appVersion: APP_VERSION,
      pushEnabled: false,
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
};

export const registerPushForegroundSync = () => {
  if (!isNativePushPlatform()) {
    return () => undefined;
  }

  const handleStateChange = ({ isActive }: { isActive: boolean }) => {
    if (!isActive || !currentContext.uid) {
      return;
    }
    void syncNativePushRegistration(currentContext.uid, currentContext.pushEnabled);
  };

  const listener = CapacitorApp.addListener('appStateChange', handleStateChange);
  return () => {
    void listener.then((handle) => handle.remove());
  };
};
