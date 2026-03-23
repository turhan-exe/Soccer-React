import { adjustTeamBudget } from '@/services/team';
import { useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useClubFinance } from './useClubFinance';

export function useTeamBudget() {
  const { user } = useAuth();
  const { cashBalance, loading } = useClubFinance();

  const adjustBudget = useCallback(
    async (delta: number) => {
      if (!user) {
        throw new Error('Kullanici oturumu bulunamadi.');
      }
      const value = await adjustTeamBudget(user.id, delta);
      return value;
    },
    [user],
  );

  return { budget: cashBalance, loading, adjustBudget };
}

export default useTeamBudget;
