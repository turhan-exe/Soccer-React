import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  Unsubscribe,
  runTransaction,
  increment,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { toast } from 'sonner';

export async function ensureUserDoc(uid: string): Promise<void> {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { diamondBalance: 0 });
  }
}

export function listenDiamondBalance(
  uid: string,
  cb: (balance: number) => void,
): Unsubscribe {
  const ref = doc(db, 'users', uid);
  return onSnapshot(ref, (snap) => {
    const data = snap.data();
    cb(data?.diamondBalance ?? 0);
  });
}

export async function mockPurchaseDiamonds(
  uid: string,
  { packId, amount, priceFiat }: { packId: string; amount: number; priceFiat?: number },
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const purchases = collection(userRef, 'diamondPurchases');
  try {
    await runTransaction(db, async (tx) => {
      tx.update(userRef, { diamondBalance: increment(amount) });
      const purchaseRef = doc(purchases);
      tx.set(purchaseRef, {
        packId,
        amount,
        priceFiat,
        paymentMethod: 'mock-crypto',
        status: 'mock_paid',
        createdAt: serverTimestamp(),
      });
    });
    toast.success('Ödeme tamamlandı');
  } catch (err) {
    console.warn(err);
    toast.error('Ödeme başarısız');
    throw err;
  }
}
