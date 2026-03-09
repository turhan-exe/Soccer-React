# Live League Rollout

## Required Configuration

### `services/match-control-api/.env`

- `MATCH_CONTROL_SECRET`
- `MATCH_CONTROL_CALLBACK_TOKEN`
- `SESSION_SIGNING_KEY`
- `MATCH_CONTROL_CALLBACK_BASE_URL`
- `FIREBASE_LIFECYCLE_URL`
- `FIREBASE_LIFECYCLE_TOKEN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` or ADC on the host
- `NODE_AGENTS`

### `services/node-agent/.env`

- `NODE_AGENT_SECRET`
- `UNITY_SERVER_BINARY`
- `ALLOCATABLE_PORTS`
- `MATCH_CONTROL_CALLBACK_BASE_URL`
- `MATCH_CONTROL_CALLBACK_TOKEN`

### `src/functions/.env`

- `MATCH_CONTROL_BASE_URL`
- `MATCH_CONTROL_SECRET`
- `LEAGUE_LIFECYCLE_SECRET`
- `BATCH_SECRET`

### Firebase Functions Environment

Use Firebase CLI project-specific dotenv files instead of relying on `functions.config()`.

Create:

- `src/functions/.env.staging`
- `src/functions/.env.prod`

Official reference:
- https://firebase.google.com/docs/functions/config-env

Important:
- Firebase documents that `functions.config()` had to be migrated before December 2025.
- As of March 4, 2026, use dotenv or Secret Manager for new deployments.

## Scripts

### Validate env wiring

```bash
npm run live-league:env:check
```

### Check the 19:00 staging window

```bash
npm run live-league:staging -- --date 2026-03-04 --mode prewarm
npm run live-league:staging -- --date 2026-03-04 --mode kickoff
npm run live-league:staging -- --date 2026-03-04 --mode final
```

### Load test control-plane concurrency

```bash
npm run live-league:load -- --count 200 --parallel 25 --kickoff --cleanup
```

`--cleanup` requires `MATCH_CONTROL_CALLBACK_TOKEN` so the script can mark generated matches failed and release node slots.

## What Is Implemented

- `match-control-api` verifies Firebase ID tokens server-side for player-facing live join and friendly routes.
- Automatic media/result backfill runs every 15 minutes and can recover missing result JSON or queue render fallback when live video upload fails.
- Operator dashboard is available at `/admin/live-league` and reads heartbeat plus fixture risk data directly from Firestore.

## Still Missing Before Production Cutover

- A real staging benchmark result file still needs to prove the `1 node = 4 live matches` assumption on target hardware.
- Android native reconnect and tactic-command UX still needs a real Unity end-to-end staging validation run.
- Real staging/prod secrets and Firebase service credentials still need to be injected into deploy environments.
