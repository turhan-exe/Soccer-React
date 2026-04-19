# Live League 25 Rollout Plan

## Goal
Run 25 leagues with live simulation in time slots, without impacting friendly matches.

## Current State (2026-03-05)
- Control API supports dedicated node pools.
- Friendly pool is isolated.
- League pool is now 5 nodes:
  - `league-01 -> 10.0.0.4 (89.167.122.255)`
  - `league-02 -> 10.0.0.5 (89.167.117.176)`
  - `league-03 -> 10.0.0.6 (89.167.127.127)`
  - `league-04 -> 10.0.0.7 (89.167.124.123)`
  - `league-05 -> 10.0.0.8 (204.168.146.29)`

## Capacity Rule
- Current production league setup = 7 matches per league per slot.
- 5 nodes x 7 slots = 35 matches at once.
- Safe 25-league distribution:
  - `12:00 -> 4 leagues (28 matches)`
  - `15:00 -> 4 leagues (28 matches)`
  - `16:00 -> 4 leagues (28 matches)`
  - `17:00 -> 4 leagues (28 matches)`
  - `18:00 -> 4 leagues (28 matches)`
  - `19:00 -> 5 leagues (35 matches)`

## Phase 1 - Stabilize 5 League Nodes
### 1) Rebuild control league pool config
```powershell
$key = "C:\Users\TURHAN\.ssh\hetzner_fhs_ed25519"
$nodeSecret = ((Select-String -Path "services/node-agent/.env" -Pattern '^NODE_AGENT_SECRET=').Line -split '=',2)[1].Trim()
.\scripts\live-league-control-recover.ps1 `
  -NodeSecret $nodeSecret `
  -RemoteHost "root@89.167.24.132" `
  -LeagueNodeIps "10.0.0.4,10.0.0.5,10.0.0.6,10.0.0.7,10.0.0.8" `
  -KeyPath $key `
  -RepoRoot "."
curl.exe -s http://89.167.24.132:8080/health
```

Expected health fields:
- `nodeAgentsFriendly: 1`
- `nodeAgentsLeague: 5`

### 2) Clear stuck league matches and restart all 5 node-agents
```powershell
$key = "C:\Users\TURHAN\.ssh\hetzner_fhs_ed25519"
$leagueHosts = @(
  "root@89.167.122.255",
  "root@89.167.117.176",
  "root@89.167.127.127",
  "root@89.167.124.123",
  "root@204.168.146.29"
)

$remoteCmd = @'
set -euo pipefail
APP=/opt/football-manager-ui/services/node-agent
ENV_FILE="$APP/.env"
test -f "$ENV_FILE"

fuser -k 9090/tcp || true
pkill -f "/opt/fhs-server" || true
pkill -f "Football" || true
pkill -f "Unity" || true

cd "$APP"
nohup node src/index.js >/var/log/node-agent.log 2>&1 &
sleep 2
ss -ltnp | grep ":9090"

AGENT_SECRET="$(sed -n "s/^NODE_AGENT_SECRET=//p" "$ENV_FILE" | head -n1 | tr -d "\r")"
curl -s -H "Authorization: Bearer ${AGENT_SECRET}" http://127.0.0.1:9090/agent/v1/capacity
echo
'@

foreach ($nodeHost in $leagueHosts) {
  Write-Host "=== $nodeHost ==="
  ssh -i $key $nodeHost $remoteCmd
}
```

Acceptance:
- Every league node returns `totalSlots=8`, `usedSlots=0`, `runningSlots=0`, `freeSlots=8`.

## Phase 2 - Scheduler Config
1. Set:
   - `LEAGUE_KICKOFF_HOURS_TR=12,15,16,17,18,19`
   - `LEAGUE_PREWARM_LEAD_MINUTES=15`
   - `LEAGUE_PREPARE_WINDOW_MINUTES=10`
   - `LEAGUE_KICKOFF_WINDOW_MINUTES=10`
2. Deploy functions.

Acceptance:
- `prepareLeagueKickoffWindow` and `kickoffPreparedLeagueMatches` run every 5 minutes.
- Outside target windows they should be no-op.

## Phase 3 - League-to-Hour Mapping
Use:
```bash
npm run live-league:assign-hours -- --project-id osm-react --hours 12,15,16,17,18,19 --distribution 4,4,4,4,4,5 --apply-fixtures --date-from 2026-03-06 --write
```

Acceptance:
- No hour exceeds 35 matches.
- Fixture `date` values match assigned slot hours.

### Runtime Audit
Use:
```bash
node scripts/live-runtime-audit.mjs --env-file services/match-control-api/.env
```

Acceptance:
- Friendly and league pools report runtime `buildId`, `assemblyHash`, and `gameAssemblyHash`.
- Any mismatch is visible in the audit JSON under `parity`.

## Phase 4 - Staging Validation
Run load per slot first (`count=40`), then full day procedural checks.

Acceptance:
- `no_free_slot=0` in slot runs.
- Match lifecycle reaches `running` or explicit `failed`.
- Result/replay/video finalize path is healthy.

## Phase 5 - Production Cutover
1. Apply the same hour mapping to production fixtures.
2. Enable slots progressively.
3. Keep friendly pool isolated from league pool.

## Rollback
1. Move to a single kickoff hour (`19`) temporarily.
2. Reduce live-enabled league groups.
3. Reschedule affected fixtures as `scheduled`.
