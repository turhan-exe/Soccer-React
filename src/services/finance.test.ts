import { describe, expect, it } from 'vitest';
import type { Player } from '@/types';
import { getExpectedRevenue, getMatchRevenueEstimate, resolveCanonicalClubBalance } from './finance';
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
});
