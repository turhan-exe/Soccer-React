import { describe, expect, it } from 'vitest';

import { resolveLiveLeagueTerminalResolution } from './liveLeagueResultState.js';

describe('liveLeagueResultState', () => {
  it('marks ended fixtures as played only when a score exists', () => {
    expect(
      resolveLiveLeagueTerminalResolution({
        lifecycleState: 'ended',
        currentStatus: 'running',
        hasResolvedScore: true,
      }),
    ).toEqual({
      fixtureStatus: 'played',
      liveState: 'ended',
      resultMissing: false,
    });

    expect(
      resolveLiveLeagueTerminalResolution({
        lifecycleState: 'ended',
        currentStatus: 'running',
        hasResolvedScore: false,
      }),
    ).toEqual({
      fixtureStatus: 'running',
      liveState: 'result_pending',
      resultMissing: true,
    });
  });

  it('keeps already-played fixtures played while flagging pending results', () => {
    expect(
      resolveLiveLeagueTerminalResolution({
        lifecycleState: 'ended',
        currentStatus: 'played',
        hasResolvedScore: false,
      }),
    ).toEqual({
      fixtureStatus: 'played',
      liveState: 'result_pending',
      resultMissing: true,
    });
  });
});
