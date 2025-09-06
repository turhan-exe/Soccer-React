import './_firebase.js';

export { lockWindowSnapshot } from './lineup/lockWindow.js';
export { orchestrate19TRT } from './orchestrate/orchestrate19trt.js';
export { startMatchHttp } from './orchestrate/startMatch.js';
export { onResultFinalize } from './results/onResultFinalize.js';
export { getReplay } from './results/getReplay.js';

// Plan 4: Sözleşmeler (React ⇄ Functions ⇄ Unity)
// League onboarding & fixtures management
export {
  assignTeamToLeague,
  assignTeamToLeagueHttp,
  requestJoinLeague,
  finalizeIfFull,
  generateRoundRobinFixturesFn,
  assignAllTeamsToLeagues,
} from './league.js';

// Lineup lock (server-side, secret protected)
export { lockLineup, setLineup } from './lineup.js';

// Live feed endpoints for Unity publisher
export { emitLive } from './live/emit.js';
export { endLive } from './live/end.js';
export { demoLive } from './live/demo.js';

// Result reporting (HTTP) in addition to Storage trigger
export { reportResult } from './results/reportResult.js';

// Operations & Observability (Plan 8)
export { cronCreateBatch, kickUnityJob, cronWatchdog } from './orchestrate/scheduler.js';
// Retry & Poison queue (Plan 10)
export { finalizeWatchdogHttp } from './orchestrate/retry.js';
// Operator callable: play all fixtures for a TR day
export { playAllForDayFn } from './orchestrate/playAll.js';
