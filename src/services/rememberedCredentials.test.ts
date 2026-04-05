import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  },
  registerPlugin: () => ({
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(),
  }),
}));

import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  parseRememberedCredentials,
  saveRememberedCredentials,
} from '@/services/rememberedCredentials';

describe('rememberedCredentials', () => {
  const createLocalStorageMock = (): Storage => {
    const store = new Map<string, string>();

    return {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.has(key) ? store.get(key)! : null;
      },
      key(index: number) {
        return Array.from(store.keys())[index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    };
  };

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
      writable: true,
    });
  });

  it('parses a valid payload', () => {
    expect(
      parseRememberedCredentials(
        JSON.stringify({
          email: 'coach@example.com',
          password: 'secret123',
          updatedAt: 123,
        }),
      ),
    ).toEqual({
      email: 'coach@example.com',
      password: 'secret123',
      updatedAt: 123,
    });
  });

  it('rejects invalid payloads', () => {
    expect(parseRememberedCredentials(null)).toBeNull();
    expect(parseRememberedCredentials('{"email":"a"}')).toBeNull();
    expect(parseRememberedCredentials('not-json')).toBeNull();
  });

  it('saves and loads remembered credentials on web', async () => {
    await saveRememberedCredentials('coach@example.com', 'secret123');

    await expect(loadRememberedCredentials()).resolves.toEqual({
      email: 'coach@example.com',
      password: 'secret123',
      updatedAt: expect.any(Number),
    });
  });

  it('clears remembered credentials on web', async () => {
    await saveRememberedCredentials('coach@example.com', 'secret123');
    await clearRememberedCredentials();

    await expect(loadRememberedCredentials()).resolves.toBeNull();
  });
});
