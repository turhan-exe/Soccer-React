import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureUserDoc, mockPurchaseDiamonds } from './diamonds';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const {
  docMock,
  getDocMock,
  setDocMock,
  collectionMock,
  runTransactionMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  setDocMock: vi.fn(),
  collectionMock: vi.fn(),
  runTransactionMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  onSnapshot: vi.fn(),
  runTransaction: (...args: unknown[]) => runTransactionMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}));

describe('diamonds service', () => {
  beforeEach(() => {
    docMock.mockReset();
    getDocMock.mockReset();
    setDocMock.mockReset();
    collectionMock.mockReset();
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

  describe('mockPurchaseDiamonds', () => {
    it('creates a user balance and purchase record when the user doc is missing', async () => {
      docMock
        .mockReturnValueOnce('user-ref')
        .mockReturnValueOnce('purchase-ref');
      collectionMock.mockReturnValue('purchase-col');

      const txSet = vi.fn();

      runTransactionMock.mockImplementationOnce(async (_db, callback) =>
        callback({
          get: vi.fn(async () => ({
            exists: () => false,
            data: () => undefined,
          })),
          set: txSet,
        }),
      );

      await mockPurchaseDiamonds('uid', {
        packId: 'starter',
        amount: 250,
        priceFiat: 4.99,
      });

      expect(txSet).toHaveBeenNthCalledWith(
        1,
        'user-ref',
        { diamondBalance: 250 },
        { merge: true },
      );
      expect(txSet).toHaveBeenNthCalledWith(
        2,
        'purchase-ref',
        expect.objectContaining({
          packId: 'starter',
          amount: 250,
          priceFiat: 4.99,
          paymentMethod: 'mock-crypto',
          status: 'mock_paid',
        }),
      );
    });
  });
});
