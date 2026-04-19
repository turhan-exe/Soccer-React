import { describe, expect, it, vi } from 'vitest';

vi.mock('../_firebase.js', () => ({}));
vi.mock('firebase-functions/v1', () => ({
  config: () => ({}),
  runWith: () => ({
    region: () => ({
      pubsub: {
        schedule: () => ({
          timeZone: () => ({
            onRun: (fn: unknown) => fn,
          }),
        }),
      },
    }),
  }),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: () => ({ set: vi.fn() }),
    collection: () => ({
      doc: () => ({ get: vi.fn(), set: vi.fn() }),
      where: () => ({ limit: () => ({ get: vi.fn() }) }),
      limit: () => ({ get: vi.fn() }),
    }),
  }),
  FieldValue: {
    serverTimestamp: () => ({ __type: 'serverTimestamp' }),
    increment: (value: number) => ({ __type: 'increment', value }),
    delete: () => ({ __type: 'delete' }),
  },
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

import { buildHistoricalRecoveryAlertEmail } from './recoveryAlerts.js';

describe('recovery alert emails', () => {
  it('builds a readable fallback email', () => {
    const email = buildHistoricalRecoveryAlertEmail({
      leagueId: 'league-1',
      fixtureId: 'fixture-9',
      fixturePath: 'leagues/league-1/fixtures/fixture-9',
      competitionType: 'champions_league',
      waveId: 'wave-1',
      reason: 'status_poll_timeout',
      attemptCount: 2,
      lastMatchId: 'fixture-9',
    });

    expect(email.subject).toContain('fixture-9');
    expect(email.subject).toContain('Champions League');
    expect(email.text).toContain('Attempts: 2');
    expect(email.text).toContain('Reason: status_poll_timeout');
  });
});
