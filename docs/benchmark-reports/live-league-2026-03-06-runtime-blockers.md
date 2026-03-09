# Live League Runtime Blockers (2026-03-06)

## Verified Current Behavior

### Probe A (6 minutes)
- Report: `docs/benchmark-reports/live-league-unity-probe-20260306202628.json`
- Match transitioned:
  - `starting -> server_started`
- But for the full probe window:
  - `liveMinute = null`
  - `endedAt = null`
  - `state` stayed `server_started`

### Probe B (direct node-agent + match-control)
- Report: `docs/benchmark-reports/live-league-node-minute-probe-20260306203305.json`
- Node-agent allocation state became `running`.
- But both remained null:
  - node-agent `liveMinute`
  - match-control `liveMinute`

Conclusion:
- Lifecycle forward path is alive (state updates happen),
- but Unity minute heartbeat/result line is not reaching runtime in current deployed binaries/process.

## Local Code Fixes Prepared

These are implemented locally and ready to deploy:

1. `services/node-agent/src/index.js`
- Minute parser expanded for real log formats:
  - `Minutes: 22,35357`
  - `prevMinute=... incomingMinute=... minuteReference=...`
  - `dakika ...`
- Supports decimal/comma minute tokens.

2. `services/match-control-api/src/index.js`
- Lifecycle minute parser expanded for decimal/comma formats.

3. `src/functions/src/liveLeague.ts`
- `ingestLeagueMatchLifecycleHttp` now persists minute data to fixture:
  - `live.minute`
  - `live.minuteUpdatedAt`

## New Operational Scripts

1. Deploy runtime fixes:
- `scripts/live-league-deploy-runtime-fixes.ps1`

2. Validate minute heartbeat end-to-end on one live match:
- `scripts/live-league-minute-probe.ps1`

## Required Manual Step (External Access)

Because control/match nodes require SSH auth from your machine, run:

1. `scripts/live-league-deploy-runtime-fixes.ps1`
2. `scripts/live-league-minute-probe.ps1`

Success criteria:
- Probe timeline shows `allocationMinute` and `matchMinute` increasing above `0`.
- Match eventually reaches `ended` with result chain, not only timeout/failure.

## Latest Re-Test (2026-03-06 20:52 TRT)

### Deploy status
- Node-agent runtime patch deployed to all 5 league nodes.
- `NODE_AGENT_DEBUG_CHILD_LOGS=true` enabled on all league nodes.

### Probe C
- Report: `docs/benchmark-reports/live-league-minute-probe-20260306205237.json`
- Still:
  - `allocationState=running`
  - `allocationMinute=null`
  - `matchState=server_started`
  - `matchMinute=null`

### Root-cause evidence from node log
- Match log includes:
  - `scene=_StartingScene`
  - `mobileAutoConnectScheduled=False`
  - no `Status: Playing, Minutes: ...` lines
- Unity throws:
  - `InvalidOperationException: Insecure connection not allowed`
  - `Non-secure network connections disabled in Player Settings`
  - stack trace in `FStudio.Networking.MatchNetworkManager.SendLifecycleCallback(...)`

Interpretation:
- Runtime parser is no longer the primary blocker.
- Current Unity dedicated server build is not progressing to simulation minute stream and rejects HTTP callback path from inside Unity.
