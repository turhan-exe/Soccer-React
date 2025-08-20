import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ensureUserDoc, listenDiamondBalance, mockPurchaseDiamonds } from '@/services/diamonds';
import type { DiamondPack } from '@/features/diamonds/packs';

interface DiamondContextValue {
  balance: number;
  purchase: (pack: DiamondPack) => Promise<void>;
}

const DiamondContext = createContext<DiamondContextValue | undefined>(undefined);

export const DiamondProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!user) return;
    ensureUserDoc(user.id);
    const unsub = listenDiamondBalance(user.id, (b) => setBalance(b));
    return () => unsub();
  }, [user]);

  const purchase = async (pack: DiamondPack) => {
    if (!user) return;
    await mockPurchaseDiamonds(user.id, {
      packId: pack.id,
      amount: pack.amount,
      priceFiat: pack.priceFiat,
    });
  };

  return (
    <DiamondContext.Provider value={{ balance, purchase }}>
      {children}
    </DiamondContext.Provider>
  );
};

export const useDiamonds = () => {
  const ctx = useContext(DiamondContext);
  if (!ctx) throw new Error('useDiamonds must be used within DiamondProvider');
  return ctx;
};
