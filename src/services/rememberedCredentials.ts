import { Capacitor, registerPlugin } from '@capacitor/core';

export type RememberedCredentials = {
  email: string;
  password: string;
  updatedAt: number;
};

type SecureCredentialsPlugin = {
  get(): Promise<{ value: string | null }>;
  set(payload: { value: string }): Promise<void>;
  clear(): Promise<void>;
};

const STORAGE_KEY = 'fhs:remembered-credentials:v1';

const SecureCredentials = registerPlugin<SecureCredentialsPlugin>('SecureCredentials');

const isNativeSecureStorageSupported = () => Capacitor.isNativePlatform();

const getWebStorage = (): Storage | null => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return globalThis.localStorage;
  }

  return null;
};

export const parseRememberedCredentials = (
  raw: string | null | undefined,
): RememberedCredentials | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RememberedCredentials>;
    if (
      typeof parsed.email !== 'string' ||
      typeof parsed.password !== 'string' ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return null;
    }

    const email = parsed.email.trim();
    const password = parsed.password;
    if (!email || !password) {
      return null;
    }

    return {
      email,
      password,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
};

const readFromWebStorage = (): RememberedCredentials | null => {
  const storage = getWebStorage();
  if (!storage) {
    return null;
  }

  return parseRememberedCredentials(storage.getItem(STORAGE_KEY));
};

const writeToWebStorage = (value: RememberedCredentials) => {
  const storage = getWebStorage();
  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(value));
};

const clearWebStorage = () => {
  const storage = getWebStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(STORAGE_KEY);
};

export const loadRememberedCredentials = async (): Promise<RememberedCredentials | null> => {
  if (!isNativeSecureStorageSupported()) {
    return readFromWebStorage();
  }

  try {
    const result = await SecureCredentials.get();
    return parseRememberedCredentials(result.value);
  } catch (error) {
    console.warn('[rememberedCredentials] load failed', error);
    return null;
  }
};

export const saveRememberedCredentials = async (
  email: string,
  password: string,
): Promise<void> => {
  const value: RememberedCredentials = {
    email: email.trim(),
    password,
    updatedAt: Date.now(),
  };

  if (!value.email || !value.password) {
    return;
  }

  if (!isNativeSecureStorageSupported()) {
    writeToWebStorage(value);
    return;
  }

  try {
    await SecureCredentials.set({
      value: JSON.stringify(value),
    });
  } catch (error) {
    console.warn('[rememberedCredentials] save failed', error);
  }
};

export const clearRememberedCredentials = async (): Promise<void> => {
  if (!isNativeSecureStorageSupported()) {
    clearWebStorage();
    return;
  }

  try {
    await SecureCredentials.clear();
  } catch (error) {
    console.warn('[rememberedCredentials] clear failed', error);
  }
};
