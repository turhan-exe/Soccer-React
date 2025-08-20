import { describe, it, expect, vi } from 'vitest';
import { resetCooldownWithDiamonds } from './academy';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const docMock = vi.fn();
const runTransactionMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  serverTimestamp: vi.fn(),
  Timestamp: { fromDate: vi.fn() },
  increment: vi.fn(),
}));

describe('resetCooldownWithDiamonds', () => {
  it('throws when not enough diamonds', async () => {
    runTransactionMock.mockImplementation(async (_db, fn) => {
      await fn({
        get: async () => ({ data: () => ({ diamondBalance: 50 }) }),
        update: vi.fn(),
      });
    });
    await expect(resetCooldownWithDiamonds('uid')).rejects.toThrow('Yetersiz elmas');
  });
});
