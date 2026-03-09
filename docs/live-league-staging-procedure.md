# Live League Staging Procedure

This is the exact staging procedure for benchmark, acceptance, and Android E2E validation.

## Manual Catch-Up

If the `18:45` prewarm window or the `19:00` kickoff window was missed, run the new admin HTTP endpoints for that exact fixture day.

Requirements:
- deployed functions must include `prepareLeagueKickoffWindowHttp`, `kickoffPreparedLeagueMatchesHttp`, or `runLeagueCatchupForDateHttp`
- send the Firebase admin secret in either `Authorization: Bearer <ADMIN_SECRET>` or `x-admin-secret: <ADMIN_SECRET>`

Examples:

```bash
curl -X POST "https://europe-west1-<project-id>.cloudfunctions.net/prepareLeagueKickoffWindowHttp" \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-03-04\"}"
```

```bash
curl -X POST "https://europe-west1-<project-id>.cloudfunctions.net/kickoffPreparedLeagueMatchesHttp" \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-03-04\"}"
```

```bash
curl -X POST "https://europe-west1-<project-id>.cloudfunctions.net/runLeagueCatchupForDateHttp" \
  -H "x-admin-secret: <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d "{\"date\":\"2026-03-04\",\"mode\":\"full\"}"
```

Accepted modes:
- `prepare`
- `kickoff`
- `full`

Do not use `full` until `MATCH_CONTROL_CALLBACK_TOKEN` is aligned on the API host, every node-agent, and any cleanup tool. If the callback token is wrong, matches can start but their lifecycle callbacks will fail with `401 invalid_callback_token`.

## A. Benchmark Procedure

### Goal

Validate whether `1 node = 4 live matches` is safe on your real staging hardware.

### Preconditions

- Staging `match-control-api` is reachable
- All node agents are online
- Unity Linux server build is installed on every match node
- Postgres is reachable from the API nodes
- Redis is reachable if enabled
- Firebase functions are deployed to staging

### Step 1: Record the staging topology

Capture this before the test:

- Number of API nodes
- Number of match nodes
- Server type per node, for example `8 vCPU / 16 GB`
- Number of UDP ports exposed per node
- Unity binary version or git hash
- `match-control-api` git hash
- functions git hash

Write it into:
- `docs/benchmark-reports/live-league-<date>.md`

### Step 2: Run control-plane load test

Command:

```bash
npm run live-league:load -- --count 200 --parallel 25 --kickoff --cleanup --out docs/benchmark-reports/live-league-2026-03-04-load.json
```

Save the file:
- `docs/benchmark-reports/live-league-2026-03-04-load.json`

Record:
- `prepare.minMs`
- `prepare.p50Ms`
- `prepare.p95Ms`
- `prepare.p99Ms`
- `prepare.maxMs`
- same values for kickoff

Pass threshold:
- No request failures
- No widespread timeout spikes
- No manual cleanup required after `--cleanup`

### Step 3: Measure node-level saturation

Run on each match node during the load:

```bash
top -b -n 1
free -m
ss -lun
```

If available, also capture:

```bash
docker stats --no-stream
```

Collect:
- CPU peak
- Memory used
- Open UDP listeners
- Any crashed Unity server processes

Pass threshold:
- CPU should not stay pinned near 100% across the kickoff window
- Memory should keep headroom for reconnects and recording
- No node should silently lose warm or running matches

### Step 4: Record dashboard counters

Open:
- `/admin/live-league`

Capture screenshots or values for:
- Active Match
- Warm Queue
- Riskli Fixture
- Played
- Node occupancy table
- Kickoff Success
- Upload Risk
- Failed
- Stuck

### Step 5: Decide node density

Decision rule:

- If 200 matches pass cleanly with strong headroom, test `5 matches per node`
- If 5 also passes, test `6 matches per node`
- Stop increasing density when CPU, memory, kickoff latency, or crash rate becomes unstable

## B. 19:00 Acceptance Procedure

### Goal

Validate the actual daily live league flow around the real kickoff time.

### Prewarm check

At `18:55 Europe/Istanbul`:

```bash
npm run live-league:staging -- --date 2026-03-04 --mode prewarm --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-prewarm.json
```

Expected:
- Every target fixture has `live.matchId`
- Every target fixture is in `warm`

### Kickoff check

At `19:01 Europe/Istanbul`:

```bash
npm run live-league:staging -- --date 2026-03-04 --mode kickoff --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-kickoff.json
```

Expected:
- Every target fixture is either `running` or explicitly `failed`
- No hidden pending fixtures remain

### Final check

After matches end:

```bash
npm run live-league:staging -- --date 2026-03-04 --mode final --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-final.json
```

Expected:
- All fixtures are `played`
- No played fixture is missing score

## C. Forced Failure Procedure

### Missing result recovery

Goal:
- Verify `backfillLiveLeagueMedia` can synthesize a missing result file

Method:
- Let a staging match end
- Remove or block the result upload once
- Confirm fixture stays non-played
- Wait for the backfill scheduler
- Confirm standings and fixture result recover

Evidence:
- Storage object appears under `results/...json`
- Dashboard backfill counters increase

### Missing video recovery

Goal:
- Verify render fallback is queued when live upload fails

Method:
- Let replay upload succeed
- Block only MP4 upload
- Confirm `videoMissing=true`
- Wait for backfill
- Confirm render fallback queue is written and `video.renderQueuedAt` exists

## D. Android E2E Procedure

### Goal

Validate join, disconnect, reconnect, and tactic command flow on a real Android device.

### Inputs to record before test

- Device model
- Android version
- App version code
- App git hash
- Unity client build hash
- Test user UID
- Test fixture ID
- Test match ID

### Test 1: Join live match

Expected:
- User opens fixture page
- `Izle` button appears only for own fixture
- App launches Unity activity
- Match connects without manual retry

Collect:
- Android screen recording
- `adb logcat` output

Commands:

```bash
adb logcat -c
adb logcat > android-live-league-join.log
```

### Test 2: Mid-match reconnect

Method:
- Join live match
- Put app to background or disable network for a short period
- Return app to foreground or restore network

Expected:
- Client reconnects to the same match
- No duplicate join
- Match state continues

Collect:
- Timestamp of disconnect
- Timestamp of reconnect
- Match ID
- Any Unity reconnect error

### Test 3: Tactic command

Method:
- Change one tactical setting mid-match

Expected:
- Unity client sends player-role command
- Server accepts it
- Match continues with no desync

Collect:
- Client-side timestamp
- Server-side log line showing receipt
- Any validation failure

### Test 4: Non-watcher flow

Method:
- Let another manager ignore the match completely

Expected:
- Match still finishes
- Result, replay, and video appear after completion

## E. Evidence Pack

For each staging run, store:

- `load-test-200.json`
- `staging-prewarm.json`
- `staging-kickoff.json`
- `staging-final.json`
- Dashboard screenshots
- Android `adb logcat` logs
- API node logs
- Node-agent logs
- One markdown summary report

Recommended report path:
- `docs/benchmark-reports/live-league-<yyyy-mm-dd>.md`
