# Match Control Services

This folder contains the Hetzner control-plane runtime for live friendly and league matches.

## Services

- `match-control-api`:
  - Public API for friendly requests, join tickets, match status, and league slot orchestration.
  - Internal lifecycle endpoint used by Unity headless servers.
- `node-agent`:
  - Runs on each match node.
  - Allocates ports, starts/stops Unity server processes, and reports capacity.

## Local Run

### 1) match-control-api

```bash
cd services/match-control-api
cp .env.example .env
npm install
npm start
```

### 2) node-agent

```bash
cd services/node-agent
cp .env.example .env
npm install
npm start
```

## Required Env

### match-control-api

- `MATCH_CONTROL_CALLBACK_BASE_URL`: public base URL of match-control-api (for Unity lifecycle callbacks)
- `MATCH_CONTROL_CALLBACK_TOKEN`: bearer token expected from Unity callbacks
- `MATCH_CONTROL_SECRET`: bearer token used by Firebase functions and operator scripts
- `SESSION_SIGNING_KEY`: HMAC signing key for join tickets
- `FIREBASE_LIFECYCLE_URL`: `ingestLeagueMatchLifecycleHttp` endpoint URL
- `FIREBASE_LIFECYCLE_TOKEN`: bearer token accepted by `ingestLeagueMatchLifecycleHttp`
- `FIREBASE_PROJECT_ID`: Firebase project id used for ID token verification
- `FIREBASE_SERVICE_ACCOUNT_JSON`: optional raw service account JSON when ADC is not available
- `NODE_AGENTS`: shared JSON list of agents (legacy, both modes use same pool)
- `NODE_AGENTS_FRIENDLY`: optional dedicated pool for friendly endpoints
- `NODE_AGENTS_LEAGUE`: optional dedicated pool for league endpoints

Example:

```json
[
  { "id": "node-a", "url": "http://10.20.0.10:9090", "token": "agent-secret" }
]
```

Dedicated pool example:

```dotenv
NODE_AGENTS_FRIENDLY=[{"id":"friendly-1","url":"http://10.0.0.11:9090","token":"friendly-secret"}]
NODE_AGENTS_LEAGUE=[{"id":"league-1","url":"http://10.0.1.11:9090","token":"league-secret"}]
```

Important:
- If `NODE_AGENTS_FRIENDLY` or `NODE_AGENTS_LEAGUE` is explicitly set (even `[]`), that mode uses exactly that list.
- This allows strict isolation: for example `NODE_AGENTS_FRIENDLY=[...]` and `NODE_AGENTS_LEAGUE=[]`.

### node-agent

- `NODE_AGENT_SECRET`: bearer token for internal agent endpoints
- `UNITY_SERVER_BINARY`: path to headless Unity server binary
- `ALLOCATABLE_PORTS`: comma-separated UDP ports (for example `21001,21002,21003`)
- `UNITY_MATCH_ROLE`: runtime role passed to Unity (`server`/`host`/`client`, default `server`)
- `MATCH_CONTROL_CALLBACK_BASE_URL`: same API base URL
- `MATCH_CONTROL_CALLBACK_TOKEN`: callback bearer token

### Firebase Functions / Live League

Create `src/functions/.env` from `src/functions/.env.example` for local emulation and set the same values in deployed Functions config:

- `MATCH_CONTROL_BASE_URL`
- `MATCH_CONTROL_SECRET`
- `LEAGUE_LIFECYCLE_SECRET`
- `BATCH_SECRET`

Recommended deploy mapping:

- Put runtime values into `src/functions/.env.<firebase-alias>`
- Deploy with `firebase use <alias>` and `firebase deploy --only functions`
- Prefer Secret Manager or dotenv over `functions.config()`

## Ops Scripts

- `npm run live-league:pool -- --id-prefix league --token <NODE_AGENT_SECRET> --ips 10.0.1.11,10.0.1.12`
  Builds JSON for `NODE_AGENTS_LEAGUE` or `NODE_AGENTS_FRIENDLY`.
- `npm run live-league:env:check`
  Validates required env files and prints the Firebase config mapping.
- `npm run live-league:staging -- --date 2026-03-04 --mode kickoff`
  Checks staging acceptance for the 19:00 league window.
- `npm run live-league:load -- --count 200 --parallel 25 --kickoff --cleanup`
  Runs a control-plane load test against `match-control-api`.

## Operator Dashboard

- Route: `/admin/live-league`
- Data source: Firestore `ops_heartbeats/{yyyy-mm-dd}` and the selected day's league fixtures
- Shows: node occupancy, warm queue depth, kickoff rate, reconcile/backfill counters, and risky fixtures

## Unity Runtime Contract

Each match process is started with:

- `--listen-port`
- `--match-id`
- `--session-secret`
- `--mode=friendly|league`
- `--max-clients`
- `--match-control-callback-url`
- `--match-control-callback-token`

## Friendly Flow (API-first)

1. Player A creates request: `POST /v1/friendly/requests`
2. Player B accepts request: `POST /v1/friendly/requests/{requestId}/accept`
3. Both players fetch their own join ticket: `POST /v1/matches/{matchId}/join-ticket`
4. Client opens Unity with `ip:port + matchId + joinTicket`

## League Flow

1. Scheduler prewarms slots: `POST /v1/league/prepare-slot`
2. Kickoff at slot time: `POST /v1/league/kickoff-slot`
3. Unity callback marks `running`/`ended`/`failed`
4. Control plane releases allocation on `ended`/`failed`

## Capacity Rollout (25 Leagues x 16 Teams)

Daily concurrent league matches:

- `25 * (16 / 2) = 200`

If one node exposes 3 allocatable ports (`ALLOCATABLE_PORTS=21001,21002,21003`):

- minimum league nodes: `ceil(200 / 3) = 67`
- with 20% hot spare: `81` league nodes

To avoid breaking friendly mode while scaling:

1. Keep friendly on its own node pool via `NODE_AGENTS_FRIENDLY`
2. Move league traffic to `NODE_AGENTS_LEAGUE`
3. Point Firebase Functions (`MATCH_CONTROL_BASE_URL`) to the league control API
4. Scale league pool in stages: 10 -> 20 -> 40 -> 60 -> 81
5. Run `live-league:load` after each stage and verify `no_free_slot` is zero
