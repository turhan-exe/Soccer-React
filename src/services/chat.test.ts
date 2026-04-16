import { describe, expect, it, vi } from 'vitest';

const { collectionMock, httpsCallableMock } = vi.hoisted(() => ({
  collectionMock: vi.fn(() => ({ path: 'globalChatMessages' })),
  httpsCallableMock: vi.fn(() => vi.fn()),
}));

vi.mock('./firebase', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(),
  collection: (...args: unknown[]) => collectionMock(...args),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  serverTimestamp: vi.fn(),
  Timestamp: class MockTimestamp {
    static fromMillis(ms: number) {
      return {
        toDate: () => new Date(ms),
        toMillis: () => ms,
      };
    }
  },
  where: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallableMock(...args),
}));

import {
  CHAT_RETENTION_DAYS,
  filterRetainedGlobalChatMessages,
  isExpiredGlobalChatMessage,
} from './chat';
import type { GlobalChatMessage } from '@/types';

describe('chat retention', () => {
  const nowMs = Date.parse('2026-04-14T12:00:00.000Z');

  it('uses a 7 day retention window', () => {
    expect(CHAT_RETENTION_DAYS).toBe(7);
  });

  it('prefers explicit expiresAt when deciding expiration', () => {
    const activeMessage = {
      createdAt: new Date('2026-04-10T12:00:00.000Z'),
      expiresAt: new Date('2026-04-15T12:00:00.000Z'),
    };
    const expiredMessage = {
      createdAt: new Date('2026-04-10T12:00:00.000Z'),
      expiresAt: new Date('2026-04-13T11:59:59.000Z'),
    };

    expect(isExpiredGlobalChatMessage(activeMessage, nowMs)).toBe(false);
    expect(isExpiredGlobalChatMessage(expiredMessage, nowMs)).toBe(true);
  });

  it('filters legacy messages by createdAt when expiresAt is missing', () => {
    const messages: GlobalChatMessage[] = [
      {
        id: 'keep-new',
        userId: 'u1',
        username: 'Manager 1',
        teamName: 'Club 1',
        text: 'fresh',
        createdAt: new Date('2026-04-12T12:00:00.000Z'),
        expiresAt: null,
      },
      {
        id: 'drop-old',
        userId: 'u2',
        username: 'Manager 2',
        teamName: 'Club 2',
        text: 'stale',
        createdAt: new Date('2026-04-06T11:59:59.000Z'),
        expiresAt: null,
      },
    ];

    expect(filterRetainedGlobalChatMessages(messages, nowMs).map((message) => message.id)).toEqual([
      'keep-new',
    ]);
  });
});
