import { describe, expect, it } from 'vitest';

import {
  deriveReplayPayloadScore,
  hasCanonicalFixtureScore,
  normalizeCanonicalFixtureScore,
} from './fixtureScore.js';

describe('fixtureScore helpers', () => {
  it('normalizes canonical and legacy score shapes', () => {
    expect(normalizeCanonicalFixtureScore({ home: 2, away: 1 })).toEqual({
      home: 2,
      away: 1,
    });
    expect(normalizeCanonicalFixtureScore({ h: 3, a: 0 })).toEqual({
      home: 3,
      away: 0,
    });
    expect(normalizeCanonicalFixtureScore({ homeGoals: 4, awayGoals: 2 })).toEqual({
      home: 4,
      away: 2,
    });
  });

  it('detects whether a fixture already has a usable score', () => {
    expect(hasCanonicalFixtureScore({ h: 1, a: 1 })).toBe(true);
    expect(hasCanonicalFixtureScore({ home: null, away: 1 })).toBe(false);
    expect(hasCanonicalFixtureScore(null)).toBe(false);
  });

  it('derives replay score from summary or goal events', () => {
    expect(
      deriveReplayPayloadScore({
        summary: {
          homeGoals: 2,
          awayGoals: 1,
        },
      }),
    ).toEqual({ home: 2, away: 1 });

    expect(
      deriveReplayPayloadScore({
        summary: {
          events: [
            { type: 'goal', club: 'home' },
            { type: 'goal', club: 'home' },
            { type: 'goal', club: 'away' },
          ],
        },
      }),
    ).toEqual({ home: 2, away: 1 });
  });
});
