import React, { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  ensureUserDoc,
  finalizeAndroidDiamondPurchase,
  listenDiamondBalance,
  spendDiamonds,
} from '@/services/diamonds';
import {
  getPlayBillingUnavailableMessage,
  isNativeAndroidPlayBillingSupported,
  startPlayBillingPurchase,
} from '@/services/playBilling';
import type { DiamondPack } from '@/features/diamonds/packs';

interface DiamondContextValue {
  balance: number;
  purchase: (pack: DiamondPack) => Promise<void>;
  spend: (amount: number) => Promise<void>;
}

const DiamondContext = createContext<DiamondContextValue | undefined>(undefined);

export const DiamondProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!user) {
      setBalance(0);
      return;
    }

    ensureUserDoc(user.id);
    const unsub = listenDiamondBalance(user.id, (nextBalance) => setBalance(nextBalance));
    return () => unsub();
  }, [user]);

  const purchase = useCallback(
    async (pack: DiamondPack) => {
      if (!user) {
        toast.error('Elmas satin almak icin giris yapmalisin.');
        return;
      }

      if (!isNativeAndroidPlayBillingSupported()) {
        const message = getPlayBillingUnavailableMessage();
        toast.error(message);
        throw new Error(message);
      }

      let purchaseResult;
      try {
        purchaseResult = await startPlayBillingPurchase({
          productId: pack.productId,
          obfuscatedAccountId: user.id,
          obfuscatedProfileId: user.id,
        });
      } catch (error) {
        console.warn('[DiamondProvider] play billing purchase failed', error);
        toast.error('Google Play satin alma akisi baslatilamadi.');
        throw error;
      }

      if (purchaseResult.status === 'cancelled') {
        return;
      }

      if (purchaseResult.status === 'pending' || purchaseResult.purchaseState === 'PENDING') {
        toast('Odeme islemi beklemede. Onaylandiginda elmaslar otomatik islenecek.');
        return;
      }

      if (!purchaseResult.purchaseToken) {
        const error = new Error('purchase_token_missing');
        console.warn('[DiamondProvider] missing purchase token', purchaseResult);
        toast.error('Google Play satin alma sonucu dogrulanamadi.');
        throw error;
      }

      try {
        const finalized = await finalizeAndroidDiamondPurchase({
          productId: pack.productId,
          purchaseToken: purchaseResult.purchaseToken,
          orderId: purchaseResult.orderId ?? null,
          packageName: purchaseResult.packageName ?? null,
        });

        if (finalized.granted) {
          if (finalized.consumeAttempted && !finalized.consumed) {
            toast.warning(
              'Elmaslar hesaba eklendi. Satin alma tuketimi tamamlanamadi; magazayi tekrar acman gerekebilir.',
            );
            return;
          }

          toast.success(`${pack.amount} elmas hesaba eklendi.`);
          return;
        }

        if (finalized.alreadyProcessed) {
          toast.success('Bu satin alma daha once hesaba islenmis.');
          return;
        }

        toast.success('Odeme dogrulandi.');
      } catch (error) {
        console.warn('[DiamondProvider] finalize android purchase failed', error);
        toast.error(
          'Odeme alindi ancak elmaslar hesaba islenemedi. Elmas magazasini tekrar acip bekleyen satin almalari senkronize et.',
        );
        throw error;
      }
    },
    [user],
  );

  const spend = useCallback(
    async (amount: number) => {
      if (!user) return;
      await spendDiamonds(user.id, amount);
    },
    [user],
  );

  return (
    <DiamondContext.Provider value={{ balance, purchase, spend }}>
      {children}
    </DiamondContext.Provider>
  );
};

export const useDiamonds = () => {
  const ctx = useContext(DiamondContext);
  if (!ctx) throw new Error('useDiamonds must be used within DiamondProvider');
  return ctx;
};
