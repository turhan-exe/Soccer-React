import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/services/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { adjustTeamBudget } from '@/services/team';

interface TeamBudgetSnapshot {
  budget?: number;
  transferBudget?: number;
}

export function useTeamBudget() {
  const { user } = useAuth();
  const [budget, setBudget] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setBudget(null);
      setLoading(false);
      return;
    }
    const teamRef = doc(db, 'teams', user.id);
    setLoading(true);
    return onSnapshot(teamRef, (snapshot) => {
      const data = (snapshot.data() as TeamBudgetSnapshot | undefined) ?? {};
      const nextBudget = Number.isFinite(data.budget)
        ? Number(data.budget)
        : Number.isFinite(data.transferBudget)
          ? Number(data.transferBudget)
          : null;
      setBudget(nextBudget);
      setLoading(false);
    });
  }, [user]);

  const adjustBudget = useCallback(
    async (delta: number) => {
      if (!user) {
        throw new Error('Kullanici oturumu bulunamadi.');
      }
      const value = await adjustTeamBudget(user.id, delta);
      setBudget(value);
      return value;
    },
    [user],
  );

  return { budget, loading, adjustBudget };
}

export default useTeamBudget;
