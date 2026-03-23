import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { ClubFinanceSnapshot, Player } from '@/types';
import { db } from '@/services/firebase';
import {
  ensureFinanceProfile,
  type ExpectedRevenueBreakdown,
  type FinanceDoc,
  type FinanceHistoryEntry,
  getExpectedRevenue,
  type StadiumState,
  type TeamSalariesDoc,
  type UserSponsorDoc,
  reconcileClubFinance,
  resolveCanonicalClubBalance,
} from '@/services/finance';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const reconciledTeamIds = new Set<string>();

type UseClubFinanceOptions = {
  includeDetails?: boolean;
};

type UseClubFinanceResult = ClubFinanceSnapshot & {
  loading: boolean;
  expectedRevenue: ExpectedRevenueBreakdown;
  history: FinanceHistoryEntry[];
  salaries: TeamSalariesDoc | null;
  stadium: StadiumState | null;
  sponsors: UserSponsorDoc[];
  teamPlayers: Player[];
  teamOwnerId: string | null;
};

export function useClubFinance(
  options: UseClubFinanceOptions = {},
): UseClubFinanceResult {
  const { includeDetails = false } = options;
  const { user } = useAuth();
  const { balance: diamondBalance } = useDiamonds();

  const [loading, setLoading] = useState(true);
  const [teamBudget, setTeamBudget] = useState<number | null>(null);
  const [legacyBudget, setLegacyBudget] = useState<number | null>(null);
  const [financeBalance, setFinanceBalance] = useState<number | null>(null);
  const [teamOwnerId, setTeamOwnerId] = useState<string | null>(null);
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [history, setHistory] = useState<FinanceHistoryEntry[]>([]);
  const [salaries, setSalaries] = useState<TeamSalariesDoc | null>(null);
  const [stadium, setStadium] = useState<StadiumState | null>(null);
  const [sponsors, setSponsors] = useState<UserSponsorDoc[]>([]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setTeamBudget(null);
      setLegacyBudget(null);
      setFinanceBalance(null);
      setTeamOwnerId(null);
      setTeamPlayers([]);
      setHistory([]);
      setSalaries(null);
      setStadium(null);
      setSponsors([]);
      return;
    }

    setLoading(true);
    void ensureFinanceProfile(user.id).catch((error) =>
      console.warn('[useClubFinance] ensure profile failed', error),
    );
    if (!reconciledTeamIds.has(user.id)) {
      reconciledTeamIds.add(user.id);
      void reconcileClubFinance(user.id).catch((error) =>
        console.warn('[useClubFinance] reconcile failed', error),
      );
    }

    const teamUnsub = onSnapshot(doc(db, 'teams', user.id), (snapshot) => {
      const data =
        (snapshot.data() as {
          budget?: number;
          transferBudget?: number;
          ownerUid?: string;
          players?: Player[];
        } | undefined) ?? {};
      setTeamBudget(typeof data.transferBudget === 'number' ? data.transferBudget : null);
      setLegacyBudget(typeof data.budget === 'number' ? data.budget : null);
      setTeamOwnerId(typeof data.ownerUid === 'string' ? data.ownerUid : null);
      setTeamPlayers(data.players ?? []);
      setLoading(false);
    });

    const financeUnsub = onSnapshot(doc(db, 'finance', user.id), (snapshot) => {
      const data = (snapshot.data() as FinanceDoc | undefined) ?? undefined;
      setFinanceBalance(typeof data?.balance === 'number' ? data.balance : null);
    });

    const unsubscribers = [teamUnsub, financeUnsub];

    if (includeDetails) {
      unsubscribers.push(
        onSnapshot(doc(db, 'teams', user.id, 'stadium', 'state'), (snapshot) => {
          setStadium((snapshot.data() as StadiumState | null) ?? null);
        }),
      );

      unsubscribers.push(
        onSnapshot(doc(db, 'teams', user.id, 'salaries', 'current'), (snapshot) => {
          setSalaries(snapshot.exists() ? ((snapshot.data() as TeamSalariesDoc) ?? null) : null);
        }),
      );

      unsubscribers.push(
        onSnapshot(collection(db, 'users', user.id, 'sponsorships'), (snapshot) => {
          setSponsors(
            snapshot.docs.map((docSnap) => ({
              id: docSnap.id,
              ...(docSnap.data() as UserSponsorDoc),
            })),
          );
        }),
      );

      const since = Timestamp.fromMillis(Date.now() - THIRTY_DAYS_MS);
      unsubscribers.push(
        onSnapshot(
          query(
            collection(db, 'finance', 'history', user.id),
            where('timestamp', '>=', since),
            orderBy('timestamp', 'desc'),
          ),
          (snapshot) => {
            setHistory(
              snapshot.docs.map(
                (docSnap) =>
                  ({
                    id: docSnap.id,
                    ...docSnap.data(),
                  }) as FinanceHistoryEntry,
              ),
            );
          },
        ),
      );
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [includeDetails, user]);

  const cashBalance = useMemo(
    () =>
      resolveCanonicalClubBalance(
        {
          transferBudget: teamBudget ?? undefined,
          budget: legacyBudget ?? undefined,
        },
        { balance: financeBalance ?? undefined },
        { hasHistory: history.length > 0 },
      ),
    [financeBalance, history.length, legacyBudget, teamBudget],
  );

  const expectedRevenue = useMemo(
    () => getExpectedRevenue(stadium, sponsors, teamPlayers, salaries?.total ?? 0),
    [salaries?.total, sponsors, stadium, teamPlayers],
  );

  const realizedTotals = useMemo(() => {
    let last30dIncome = 0;
    let last30dExpense = 0;

    history.forEach((entry) => {
      if (entry.type === 'income') {
        last30dIncome += entry.amount;
        return;
      }
      last30dExpense += entry.amount;
    });

    return {
      last30dIncome,
      last30dExpense,
      last30dNet: last30dIncome - last30dExpense,
    };
  }, [history]);

  return {
    loading,
    cashBalance,
    diamondBalance,
    projectedMonthlyIncome: expectedRevenue.monthly,
    projectedMonthlyExpense: expectedRevenue.projectedMonthlyExpense,
    projectedMonthlyNet: expectedRevenue.projectedMonthlyNet,
    last30dIncome: realizedTotals.last30dIncome,
    last30dExpense: realizedTotals.last30dExpense,
    last30dNet: realizedTotals.last30dNet,
    expectedRevenue,
    history,
    salaries,
    stadium,
    sponsors,
    teamPlayers,
    teamOwnerId,
  };
}

export default useClubFinance;
