export type LiveLeagueTerminalResolution = {
  fixtureStatus: 'scheduled' | 'running' | 'played' | 'failed';
  liveState: string;
  resultMissing: boolean;
};

export function resolveLiveLeagueTerminalResolution(input: {
  lifecycleState: string;
  currentStatus: string;
  hasResolvedScore: boolean;
}): LiveLeagueTerminalResolution {
  const lifecycleState = String(input.lifecycleState || '').trim().toLowerCase();
  const currentStatus = String(input.currentStatus || '').trim().toLowerCase();
  const hasResolvedScore = input.hasResolvedScore === true;

  switch (lifecycleState) {
    case 'warm':
    case 'starting':
      return {
        fixtureStatus: currentStatus === 'played' ? 'played' : 'scheduled',
        liveState: lifecycleState,
        resultMissing: false,
      };
    case 'server_started':
    case 'running':
      return {
        fixtureStatus: currentStatus === 'played' ? 'played' : 'running',
        liveState: lifecycleState,
        resultMissing: false,
      };
    case 'ended':
      return {
        fixtureStatus: hasResolvedScore
          ? 'played'
          : currentStatus === 'played'
            ? 'played'
            : 'running',
        liveState: hasResolvedScore ? 'ended' : 'result_pending',
        resultMissing: !hasResolvedScore,
      };
    case 'failed':
      return {
        fixtureStatus: currentStatus === 'played' ? 'played' : 'failed',
        liveState: 'failed',
        resultMissing: false,
      };
    default:
      return {
        fixtureStatus:
          currentStatus === 'played' ||
          currentStatus === 'failed' ||
          currentStatus === 'running'
            ? (currentStatus as 'running' | 'played' | 'failed')
            : 'scheduled',
        liveState: lifecycleState,
        resultMissing: false,
      };
  }
}
