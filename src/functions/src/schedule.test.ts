import { beforeEach, describe, expect, it, vi } from 'vitest';

type DocData = Record<string, any>;

class FakeTimestamp {
  private readonly value: Date;

  constructor(value: Date) {
    this.value = value;
  }

  toDate() {
    return this.value;
  }

  toMillis() {
    return this.value.getTime();
  }
}

class FakeBatch {
  private readonly ops: Array<() => void> = [];

  set(ref: FakeDocRef, data: DocData, options?: { merge?: boolean }) {
    this.ops.push(() => ref.applySet(data, options));
  }

  delete(ref: FakeDocRef) {
    this.ops.push(() => ref.applyDelete());
  }

  async commit() {
    this.ops.splice(0).forEach((op) => op());
  }
}

class FakeDocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  readonly ref: FakeDocRef;

  constructor(ref: FakeDocRef, private readonly value: DocData | null) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = value != null;
  }

  data() {
    return this.value;
  }
}

class FakeQuerySnapshot {
  readonly empty: boolean;
  readonly size: number;

  constructor(readonly docs: FakeDocSnapshot[]) {
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
}

class FakeCollectionRef {
  constructor(private readonly db: FakeFirestore, readonly path: string) {}

  doc(id?: string) {
    const resolved = id || this.db.nextId();
    return new FakeDocRef(this.db, `${this.path}/${resolved}`);
  }

  async get() {
    return new FakeQuerySnapshot(this.db.getCollectionDocs(this.path));
  }

  limit(count: number) {
    return {
      get: async () => new FakeQuerySnapshot(this.db.getCollectionDocs(this.path).slice(0, count)),
    };
  }
}

class FakeDocRef {
  readonly id: string;

  constructor(private readonly db: FakeFirestore, readonly path: string) {
    this.id = path.split('/').pop() || '';
  }

  collection(name: string) {
    return new FakeCollectionRef(this.db, `${this.path}/${name}`);
  }

  async get() {
    return new FakeDocSnapshot(this, this.db.getDoc(this.path));
  }

  async set(data: DocData, options?: { merge?: boolean }) {
    this.applySet(data, options);
  }

  applySet(data: DocData, options?: { merge?: boolean }) {
    this.db.setDoc(this.path, data, options);
  }

  applyDelete() {
    this.db.deleteDoc(this.path);
  }
}

class FakeFirestore {
  private readonly docs = new Map<string, DocData>();
  private autoId = 0;

  private clone(value: any): any {
    if (value instanceof FakeTimestamp) return value;
    if (Array.isArray(value)) return value.map((item) => this.clone(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.clone(item)]));
    }
    return value;
  }

  seedDoc(path: string, data: DocData) {
    this.docs.set(path, this.clone(data));
  }

  collection(path: string) {
    return new FakeCollectionRef(this, path);
  }

  batch() {
    return new FakeBatch();
  }

  nextId() {
    this.autoId += 1;
    return `auto-${this.autoId}`;
  }

  getDoc(path: string) {
    const value = this.docs.get(path);
    return value ? this.clone(value) : null;
  }

  getCollectionDocs(path: string) {
    const prefix = `${path}/`;
    return [...this.docs.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .sort((a, b) => a.localeCompare(b))
      .map((key) => new FakeDocSnapshot(new FakeDocRef(this, key), this.getDoc(key)));
  }

  setDoc(path: string, data: DocData, options?: { merge?: boolean }) {
    const current = this.docs.get(path) || {};
    const payload = options?.merge ? { ...this.clone(current), ...this.clone(data) } : this.clone(data);
    this.docs.set(path, payload);
  }

  deleteDoc(path: string) {
    this.docs.delete(path);
  }
}

const serverTimestamp = { __type: 'serverTimestamp' } as const;

let fakeDb: FakeFirestore;

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => fakeDb,
  FieldValue: {
    serverTimestamp: () => serverTimestamp,
  },
  Timestamp: {
    fromDate: (value: Date) => new FakeTimestamp(value),
  },
}));

vi.mock('firebase-functions/v1', () => {
  const builder = () => ({
    region: () => ({
      pubsub: {
        schedule: () => ({
          timeZone: () => ({
            onRun: (fn: unknown) => fn,
          }),
        }),
      },
      https: {
        onRequest: (fn: unknown) => fn,
        onCall: (fn: unknown) => fn,
      },
    }),
  });

  return {
    config: () => ({}),
    runWith: () => builder(),
    region: () => ({
      pubsub: {
        schedule: () => ({
          timeZone: () => ({
            onRun: (fn: unknown) => fn,
          }),
        }),
      },
      https: {
        onRequest: (fn: unknown) => fn,
        onCall: (fn: unknown) => fn,
      },
    }),
    https: {
      HttpsError: class HttpsError extends Error {
        code: string;

        constructor(code: string, message: string) {
          super(message);
          this.code = code;
        }
      },
    },
  };
});

vi.mock('./_firebase.js', () => ({}));

vi.mock('./notify/matchReminder.js', () => ({
  enqueueLeagueMatchReminders: async (_leagueId: string, jobs: Array<{ fixtureId: string }>) => ({
    scheduled: jobs.length,
    failed: 0,
  }),
}));

function makeLeague(leagueId: string, capacity: number, name: string) {
  fakeDb.seedDoc(`leagues/${leagueId}`, {
    name,
    season: 1,
    timezone: 'Europe/Istanbul',
    kickoffHourTR: 19,
    capacity,
    state: 'active',
    createdAt: new FakeTimestamp(new Date('2026-03-01T00:00:00.000Z')),
  });
}

function makeTeam(teamId: string, leagueId: string) {
  fakeDb.seedDoc(`teams/${teamId}`, {
    name: teamId,
    ownerUid: `owner-${teamId}`,
    leagueId,
    createdAt: new FakeTimestamp(new Date('2026-03-01T00:00:00.000Z')),
  });
}

function makeLeagueSlots(leagueId: string, humans: string[], totalSlots: number) {
  humans.forEach((teamId, index) => {
    fakeDb.seedDoc(`leagues/${leagueId}/slots/${index + 1}`, {
      slotIndex: index + 1,
      type: 'human',
      teamId,
      botId: null,
    });
  });

  for (let slotIndex = humans.length + 1; slotIndex <= totalSlots; slotIndex += 1) {
    fakeDb.seedDoc(`leagues/${leagueId}/slots/${slotIndex}`, {
      slotIndex,
      type: 'bot',
      teamId: null,
      botId: `bot-${leagueId}-${slotIndex}`,
    });
  }
}

describe('resetSeasonMonthlyInternal', () => {
  beforeEach(() => {
    fakeDb = new FakeFirestore();
    vi.resetModules();
  });

  it('rebalances overflow humans into existing leagues and rewrites 14-team fixtures', async () => {
    makeLeague('league-1', 16, 'Lig 1');
    makeLeague('league-2', 16, 'Lig 2');

    const leagueOneHumans = Array.from({ length: 16 }, (_, index) => `a${index + 1}`);
    const leagueTwoHumans = Array.from({ length: 12 }, (_, index) => `b${index + 1}`);

    leagueOneHumans.forEach((teamId) => makeTeam(teamId, 'league-1'));
    leagueTwoHumans.forEach((teamId) => makeTeam(teamId, 'league-2'));

    makeLeagueSlots('league-1', leagueOneHumans, 16);
    makeLeagueSlots('league-2', leagueTwoHumans, 16);

    const { resetSeasonMonthlyInternal } = await import('./schedule');
    const result = await resetSeasonMonthlyInternal({ targetMonth: '2026-04' });

    expect(result.capacity).toBe(14);
    expect(result.rounds).toBe(26);
    expect(result.createdLeagues).toBe(0);

    const leagueOneSlots = fakeDb.getCollectionDocs('leagues/league-1/slots');
    const leagueTwoSlots = fakeDb.getCollectionDocs('leagues/league-2/slots');
    const leagueOneFixtures = fakeDb.getCollectionDocs('leagues/league-1/fixtures');
    const leagueTwoFixtures = fakeDb.getCollectionDocs('leagues/league-2/fixtures');

    expect(leagueOneSlots).toHaveLength(14);
    expect(leagueTwoSlots).toHaveLength(14);
    expect(leagueOneFixtures).toHaveLength(182);
    expect(leagueTwoFixtures).toHaveLength(182);

    expect(fakeDb.getDoc('leagues/league-1/slots/15')).toBeNull();
    expect(fakeDb.getDoc('leagues/league-2/slots/15')).toBeNull();

    const leagueTwoHumanIds = leagueTwoSlots
      .map((doc) => doc.data()?.teamId)
      .filter(Boolean);
    expect(leagueTwoHumanIds).toContain('a15');
    expect(leagueTwoHumanIds).toContain('a16');

    expect(fakeDb.getDoc('teams/a15')?.leagueId).toBe('league-2');
    expect(fakeDb.getDoc('teams/a16')?.leagueId).toBe('league-2');
  });

  it('does not create duplicate overflow leagues when the reset reruns', async () => {
    makeLeague('league-1', 16, 'Lig 1');
    makeLeague('league-2', 16, 'Lig 2');

    const leagueOneHumans = Array.from({ length: 16 }, (_, index) => `c${index + 1}`);
    const leagueTwoHumans = Array.from({ length: 14 }, (_, index) => `d${index + 1}`);

    leagueOneHumans.forEach((teamId) => makeTeam(teamId, 'league-1'));
    leagueTwoHumans.forEach((teamId) => makeTeam(teamId, 'league-2'));

    makeLeagueSlots('league-1', leagueOneHumans, 16);
    makeLeagueSlots('league-2', leagueTwoHumans, 16);

    const { resetSeasonMonthlyInternal } = await import('./schedule');

    const first = await resetSeasonMonthlyInternal({ targetMonth: '2026-04' });
    expect(first.createdLeagues).toBe(1);
    expect(fakeDb.getCollectionDocs('leagues')).toHaveLength(3);

    const second = await resetSeasonMonthlyInternal({ targetMonth: '2026-04' });
    expect(second.createdLeagues).toBe(0);
    expect(fakeDb.getCollectionDocs('leagues')).toHaveLength(3);
  });
});
