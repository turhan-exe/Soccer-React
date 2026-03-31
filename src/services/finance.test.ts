import { Timestamp } from 'firebase/firestore';
import { describe, expect, it } from 'vitest';
import type { Player } from '@/types';
import {
  applyUnderpaidSalaryPenaltyForMonth,
  getExpectedRevenue,
  getIstanbulDateKey,
  getMatchRevenueEstimate,
  getSponsorPayoutAvailability,
  getVipDailyCreditAvailability,
  resolveCanonicalClubBalance,
  STADIUM_LEVELS,
} from './finance';
import { INITIAL_CLUB_BALANCE } from '@/lib/clubFinance';

const createPlayer = (id: number, overall: number, squadRole: Player['squadRole'] = 'starting'): Player => ({
  id: `p-${id}`,
  name: `Player ${id}`,
  position: id === 0 ? 'GK' : 'CM',
  roles: id === 0 ? ['GK'] : ['CM'],
  overall,
  potential: overall,
  attributes: {
    strength: overall,
    acceleration: overall,
    topSpeed: overall,
    dribbleSpeed: overall,
    jump: overall,
    tackling: overall,
    ballKeeping: overall,
    passing: overall,
    longBall: overall,
    agility: overall,
    shooting: overall,
    shootPower: overall,
    positioning: overall,
    reaction: overall,
    ballControl: overall,
  },
  age: 24,
  height: 180,
  weight: 75,
  health: 1,
  condition: 1,
  motivation: 1,
  squadRole,
  contract: {
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'active',
    salary: 5000,
  },
});

describe('finance revenue model', () => {
  it('increases match income when team strength rises', () => {
    const weakerTeam = Array.from({ length: 11 }, (_, index) => createPlayer(index, 52));
    const strongerTeam = Array.from({ length: 11 }, (_, index) => createPlayer(index, 78));

    const weakRevenue = getMatchRevenueEstimate(1, weakerTeam);
    const strongRevenue = getMatchRevenueEstimate(1, strongerTeam);

    expect(strongRevenue.teamStrength).toBeGreaterThan(weakRevenue.teamStrength);
    expect(strongRevenue.matchEstimate).toBeGreaterThan(weakRevenue.matchEstimate);
    expect(strongRevenue.monthlyMatchEstimate).toBeGreaterThan(weakRevenue.monthlyMatchEstimate);
  });

  it('increases match income when stadium level rises', () => {
    const team = Array.from({ length: 11 }, (_, index) => createPlayer(index, 60));

    const levelOne = getMatchRevenueEstimate(1, team);
    const levelThree = getMatchRevenueEstimate(3, team);

    expect(levelThree.matchEstimate).toBeGreaterThan(levelOne.matchEstimate);
    expect(levelThree.occupiedSeats).toBeGreaterThan(levelOne.occupiedSeats);
  });

  it('keeps stadium upgrades from paying back in a single match', () => {
    const team = Array.from({ length: 11 }, (_, index) => createPlayer(index, 60));

    ([1, 2, 3, 4] as const).forEach((level) => {
      const currentRevenue = getMatchRevenueEstimate(level, team).matchEstimate;
      const nextRevenue = getMatchRevenueEstimate((level + 1) as 2 | 3 | 4 | 5, team).matchEstimate;
      const incrementalRevenue = nextRevenue - currentRevenue;

      expect(STADIUM_LEVELS[level + 1 as 2 | 3 | 4 | 5].upgradeCost).toBeGreaterThan(incrementalRevenue * 2);
    });
  });

  it('adds sponsor income into monthly estimate', () => {
    const team = Array.from({ length: 11 }, (_, index) => createPlayer(index, 58));

    const noSponsor = getExpectedRevenue({ level: 1, incomePerMatch: 30000, upgradeCost: 20000 }, [], team);
    const withSponsor = getExpectedRevenue(
      { level: 1, incomePerMatch: 30000, upgradeCost: 20000 },
      [
        {
          id: 's1',
          catalogId: 's1',
          name: 'Free',
          type: 'free',
          reward: { amount: 5000, cycle: 'daily' },
          active: true,
          activatedAt: {} as never,
        },
      ],
      team,
    );

    expect(withSponsor.sponsorEstimate).toBe(150000);
    expect(withSponsor.monthly).toBeGreaterThan(noSponsor.monthly);
  });

  it('uses transfer budget as the canonical club balance', () => {
    const balance = resolveCanonicalClubBalance(
      { transferBudget: 87500, budget: 50000 },
      { balance: 120000 },
      { hasHistory: true },
    );

    expect(balance).toBe(87500);
  });

  it('repairs the legacy zero-team-vs-finance-start mismatch', () => {
    const balance = resolveCanonicalClubBalance(
      { transferBudget: 0, budget: 0 },
      { balance: INITIAL_CLUB_BALANCE },
      { hasHistory: false },
    );

    expect(balance).toBe(INITIAL_CLUB_BALANCE);
  });

  it('prefers finance balance when team budget is stale at zero', () => {
    const balance = resolveCanonicalClubBalance(
      { transferBudget: 0, budget: 0 },
      { balance: 10000 },
      { hasHistory: true },
    );

    expect(balance).toBe(10000);
  });

  it('projects monthly expense and net together with revenue', () => {
    const team = Array.from({ length: 11 }, (_, index) => createPlayer(index, 65));
    const revenue = getExpectedRevenue(
      { level: 1, incomePerMatch: 30000, upgradeCost: 20000 },
      [],
      team,
      40000,
    );

    expect(revenue.projectedMonthlyExpense).toBe(40000);
    expect(revenue.projectedMonthlyNet).toBe(revenue.monthly - revenue.projectedMonthlyExpense);
  });

  it('keeps daily sponsor payout locked until the next payout time', () => {
    const availability = getSponsorPayoutAvailability(
      {
        reward: { amount: 10000, cycle: 'daily' },
        activatedAt: Timestamp.fromMillis(1_000),
        lastPayoutAt: null,
        nextPayoutAt: null,
      },
      1_000 + 60_000,
    );

    expect(availability.canCollect).toBe(false);
    expect(availability.nextPayoutAt?.getTime()).toBe(1_000 + 24 * 60 * 60 * 1000);
  });

  it('marks daily sponsor payout collectible after one full day', () => {
    const availability = getSponsorPayoutAvailability(
      {
        reward: { amount: 10000, cycle: 'daily' },
        activatedAt: Timestamp.fromMillis(1_000),
        lastPayoutAt: null,
        nextPayoutAt: null,
      },
      1_000 + 24 * 60 * 60 * 1000,
    );

    expect(availability.canCollect).toBe(true);
    expect(availability.remainingMs).toBe(0);
  });

  it('locks vip daily credit after a same-day Istanbul claim', () => {
    const availability = getVipDailyCreditAvailability(
      true,
      { lastClaimDate: '2026-03-28' },
      new Date('2026-03-27T21:05:00.000Z'),
    );

    expect(availability.claimedToday).toBe(true);
    expect(availability.canClaim).toBe(false);
    expect(availability.todayKey).toBe('2026-03-28');
    expect(availability.nextClaimDateKey).toBe('2026-03-29');
  });

  it('keeps Istanbul day key stable until UTC+3 midnight', () => {
    expect(getIstanbulDateKey(new Date('2026-03-27T20:59:59.000Z'))).toBe('2026-03-27');
    expect(getIstanbulDateKey(new Date('2026-03-27T21:00:00.000Z'))).toBe('2026-03-28');
  });

  it('applies the underpaid motivation penalty once per month and tracks state', () => {
    const player = createPlayer(1, 0.8);
    player.contract = {
      expiresAt: '2099-01-01T00:00:00.000Z',
      status: 'active',
      salary: 100,
    };
    player.motivation = 0.8;

    const firstMonth = applyUnderpaidSalaryPenaltyForMonth([player], '2026-03');
    const penalizedPlayer = firstMonth.players[0];

    expect(firstMonth.changed).toBe(true);
    expect(firstMonth.penalizedPlayerIds).toEqual(['p-1']);
    expect(penalizedPlayer.motivation).toBe(0.75);
    expect(penalizedPlayer.motivationState?.underpaidActive).toBe(true);
    expect(penalizedPlayer.motivationState?.underpaidLastAppliedMonth).toBe('2026-03');

    const repeatedMonth = applyUnderpaidSalaryPenaltyForMonth(firstMonth.players, '2026-03');
    expect(repeatedMonth.penalizedPlayerIds).toEqual([]);
    expect(repeatedMonth.players[0].motivation).toBe(0.75);
  });
});
