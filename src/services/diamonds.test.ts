import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureUserDoc } from './diamonds';

vi.mock('./firebase', () => ({ db: {} }));

const docMock = vi.fn();
const getDocMock = vi.fn();
const setDocMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
}));

describe('ensureUserDoc', () => {
  beforeEach(() => {
    docMock.mockReturnValue('ref');
    getDocMock.mockReset();
    setDocMock.mockReset();
  });

  it('creates document if missing', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    await ensureUserDoc('uid');
    expect(setDocMock).toHaveBeenCalledWith('ref', { diamondBalance: 0 });
  });

  it('skips creation if document exists', async () => {
    getDocMock.mockResolvedValue({ exists: () => true });
    await ensureUserDoc('uid');
    expect(setDocMock).not.toHaveBeenCalled();
  });
});
