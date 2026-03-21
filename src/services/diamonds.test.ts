import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUserDoc, spendDiamonds } from './diamonds';

vi.mock('./firebase', () => ({ db: {}, functions: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('@/features/diamonds/packs', () => ({ getDiamondPackByProductId: vi.fn() }));
vi.mock('./playBilling', () => ({ listOwnedPlayBillingPurchases: vi.fn() }));

const {
  docMock,
  getDocMock,
  setDocMock,
  runTransactionMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  setDocMock: vi.fn(),
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  onSnapshot: vi.fn(),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
}));

describe('diamonds service', () => {
  beforeEach(() => {
    docMock.mockReset();
    getDocMock.mockReset();
    setDocMock.mockReset();
    runTransactionMock.mockReset();
  });

  describe('ensureUserDoc', () => {
    it('creates document if missing', async () => {
      docMock.mockReturnValue('ref');
      getDocMock.mockResolvedValue({ exists: () => false });

      await ensureUserDoc('uid');

      expect(setDocMock).toHaveBeenCalledWith('ref', { diamondBalance: 0 });
    });

    it('skips creation if document exists', async () => {
      docMock.mockReturnValue('ref');
      getDocMock.mockResolvedValue({ exists: () => true });

      await ensureUserDoc('uid');

      expect(setDocMock).not.toHaveBeenCalled();
    });
  });

  describe('spendDiamonds', () => {
    it('deducts balance when enough diamonds exist', async () => {
      docMock.mockReturnValue('user-ref');
      const txSet = vi.fn();

      runTransactionMock.mockImplementationOnce(async (_db, callback) =>
        callback({
          get: vi.fn(async () => ({
            data: () => ({ diamondBalance: 250 }),
          })),
          set: txSet,
        }),
      );

      await spendDiamonds('uid', 120);

      expect(txSet).toHaveBeenCalledWith(
        'user-ref',
        { diamondBalance: 130 },
        { merge: true },
      );
    });

    it('throws when balance is insufficient', async () => {
      docMock.mockReturnValue('user-ref');

      runTransactionMock.mockImplementationOnce(async (_db, callback) =>
        callback({
          get: vi.fn(async () => ({
            data: () => ({ diamondBalance: 20 }),
          })),
          set: vi.fn(),
        }),
      );

      await expect(spendDiamonds('uid', 120)).rejects.toThrow('Yeterli elmas yok');
    });
  });
});
