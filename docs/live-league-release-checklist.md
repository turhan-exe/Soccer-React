# Live League Release Checklist

This checklist is the exact handoff for staging and production rollout of the live league system.

For callback token mismatch recovery:
- see `docs/live-league-callback-token-sync.md`

## 1. Create the secrets

Generate candidate secrets locally:

```bash
npm run live-league:secrets -- --node-agents 10 > live-league-secrets.txt
```

Move the generated values into a password manager. Do not commit `live-league-secrets.txt`.

You need these values:

- `MATCH_CONTROL_SECRET`
- `MATCH_CONTROL_CALLBACK_TOKEN`
- `SESSION_SIGNING_KEY`
- `FIREBASE_LIFECYCLE_TOKEN`
- `LEAGUE_LIFECYCLE_SECRET`
- `BATCH_SECRET`
- One secret per node agent, for example `NODE_AGENT_01_SECRET`

## 2. Collect the external values

### Firebase Console

Site:
- `https://console.firebase.google.com/`

Project values you need:
- Project ID
- Web app config values for `.env.local` if they are not already set
- Storage bucket name if it changed

Path:
- Open your project
- `Project settings` -> `General`

Copy these values into:
- Repo root `.env.local`
- `services/match-control-api/.env`
- not into `src/functions/.env.*` because Firebase reserves the `FIREBASE_` prefix there

Fields:
- `VITE_FIREBASE_PROJECT_ID`
- `FIREBASE_PROJECT_ID`

### Firebase Service Account

Official reference:
- Firebase Admin setup: https://firebase.google.com/docs/admin/setup

Site:
- `https://console.firebase.google.com/`

Path:
- `Project settings` -> `Service accounts` -> `Generate new private key`

What to download:
- One JSON service account key for the Firebase project used by live league

Where to place it:

Option A, recommended for Hetzner Linux hosts:
- Upload the JSON file to the API host, for example `/opt/mgx/secrets/firebase-admin.json`
- Set `GOOGLE_APPLICATION_CREDENTIALS=/opt/mgx/secrets/firebase-admin.json`

Option B, supported by current code:
- Convert the JSON file into a single-line JSON string
- Put it into `services/match-control-api/.env` as `FIREBASE_SERVICE_ACCOUNT_JSON=...`

Windows PowerShell conversion command:

```powershell
$json = Get-Content "C:\path\to\firebase-admin.json" -Raw
$oneLine = ($json | ConvertFrom-Json | ConvertTo-Json -Compress)
$oneLine
```

You also need:
- `FIREBASE_PROJECT_ID=<your-project-id>` in `services/match-control-api/.env`

### Hetzner Cloud

Official references:
- Create server: https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server
- Firewalls overview: https://docs.hetzner.com/cloud/firewalls/overview
- Networks configuration: https://docs.hetzner.com/cloud/networks/server-configuration
- Volumes overview: https://docs.hetzner.com/cloud/volumes/overview/

Site:
- `https://console.hetzner.cloud/`

What to create:
- `2` control-plane hosts for `match-control-api`
- `N` match hosts for `node-agent`
- One private network for east-west traffic
- One firewall profile for API nodes
- One firewall profile for match nodes
- Optional volume for persistent logs and uploaded binaries

Firewall values:

API node inbound:
- TCP `22` from your admin IP
- TCP `8080` from frontend/Firebase/public traffic as needed

Match node inbound:
- TCP `22` from your admin IP
- TCP `9090` from control-plane private network only
- TCP match ports from players, for example `21001-21200`

Network values:
- Attach every API and match node to the same private network
- Use private IPs inside `NODE_AGENTS` URLs when possible

### Firebase CLI Auth

Site:
- `https://console.firebase.google.com/`

Local requirement:
- `firebase login`
- `firebase use <alias>`

If you do not have aliases yet:

```bash
firebase use --add
```

Then create environment files:
- `src/functions/.env.staging`
- `src/functions/.env.prod`

Important:
- Firebase's official docs state `functions.config()` migrations were required before December 2025.
- Use `.env.<alias>` files or Secret Manager for new deployments.
- Do not rely on `firebase functions:config:set` as the primary path in March 2026.

Official reference:
- https://firebase.google.com/docs/functions/config-env

## 3. Fill the exact files

### `services/match-control-api/.env`

Required keys:

```dotenv
PORT=8080
HOST=0.0.0.0
MATCH_CONTROL_SECRET=<paste>
MATCH_CONTROL_CALLBACK_TOKEN=<paste>
SESSION_SIGNING_KEY=<paste>
MATCH_CONTROL_CALLBACK_BASE_URL=https://match-control-staging.example.com
FIREBASE_LIFECYCLE_URL=https://europe-west1-<project-id>.cloudfunctions.net/ingestLeagueMatchLifecycleHttp
FIREBASE_LIFECYCLE_TOKEN=<paste>
FIREBASE_PROJECT_ID=<project-id>
GOOGLE_APPLICATION_CREDENTIALS=/opt/mgx/secrets/firebase-admin.json
# or FIREBASE_SERVICE_ACCOUNT_JSON=<single-line-json>
POSTGRES_URL=postgresql://<user>:<pass>@<host>:5432/<db>
REDIS_URL=redis://<host>:6379
NODE_AGENTS=[{"id":"node-a","url":"http://10.0.1.11:9090","token":"<node-agent-secret>"}]
# Optional dedicated pools to isolate friendly and league traffic:
# NODE_AGENTS_FRIENDLY=[{"id":"friendly-a","url":"http://10.0.2.11:9090","token":"<friendly-node-secret>"}]
# NODE_AGENTS_LEAGUE=[{"id":"league-a","url":"http://10.0.1.11:9090","token":"<league-node-secret>"}]
```

Tip:
- build long node lists with:
  `npm run live-league:pool -- --id-prefix league --token <NODE_AGENT_SECRET> --ips 10.0.1.11,10.0.1.12`

### `services/node-agent/.env`

One file per host:

```dotenv
PORT=9090
HOST=0.0.0.0
NODE_ID=node-a
NODE_PUBLIC_IP=<public-ip>
NODE_PRIVATE_IP=<private-ip>
NODE_AGENT_SECRET=<paste>
UNITY_SERVER_BINARY=/opt/fhs-server/FHS.x86_64
UNITY_SERVER_WORKDIR=/opt/fhs-server
ALLOCATABLE_PORTS=21001,21002,21003,21004
MATCH_CONTROL_CALLBACK_BASE_URL=https://match-control-staging.example.com
MATCH_CONTROL_CALLBACK_TOKEN=<MATCH_CONTROL_CALLBACK_TOKEN>
```

Important:
- `MATCH_CONTROL_CALLBACK_TOKEN` must be exactly the same value in every place below
- API host: `/opt/mgx/services/match-control-api/.env`
- Every match node: `/opt/mgx/services/node-agent/.env`
- Any manual lifecycle or load-test cleanup call that hits `/v1/internal/matches/:matchId/lifecycle`

If these values do not match:
- prepare and kickoff can still succeed
- but node-agent lifecycle callbacks and cleanup calls will fail with `401 invalid_callback_token`
- the match can stay stuck in `warm`, `server_started`, or `running`

### `src/functions/.env.staging`

```dotenv
MATCH_CONTROL_BASE_URL=https://match-control-staging.example.com
MATCH_CONTROL_SECRET=<MATCH_CONTROL_SECRET>
LEAGUE_LIFECYCLE_SECRET=<LEAGUE_LIFECYCLE_SECRET>
BATCH_SECRET=<BATCH_SECRET>
```

### `src/functions/.env.prod`

```dotenv
MATCH_CONTROL_BASE_URL=https://match-control.example.com
MATCH_CONTROL_SECRET=<MATCH_CONTROL_SECRET>
LEAGUE_LIFECYCLE_SECRET=<LEAGUE_LIFECYCLE_SECRET>
BATCH_SECRET=<BATCH_SECRET>
```

### Frontend `.env.local` or CI variables

If frontend should call match-control directly:

```dotenv
VITE_MATCH_CONTROL_BASE_URL=https://match-control-staging.example.com
```

Usually do not expose:
- `VITE_MATCH_CONTROL_BEARER`

## 4. Prepare the hosts

For `25` leagues and `16` teams per league, do capacity planning before acceptance tests:
- concurrent league matches: `200`
- if each node has `3` allocatable ports, league needs `67` nodes minimum
- with 20% spare, plan `81` league nodes
- keep friendly mode on a separate node pool

### API host

```bash
ssh root@<api-host>
mkdir -p /opt/mgx/services /opt/mgx/secrets
```

Upload files:

```bash
scp -r services/match-control-api root@<api-host>:/opt/mgx/services/
scp services/match-control-api/.env root@<api-host>:/opt/mgx/services/match-control-api/.env
scp firebase-admin.json root@<api-host>:/opt/mgx/secrets/firebase-admin.json
```

Install and run:

```bash
ssh root@<api-host>
cd /opt/mgx/services/match-control-api
npm ci
node src/index.js
```

After changing callback or auth env values, restart the service:

```bash
sudo systemctl restart match-control-api
```

For process supervision, use `systemd`, Docker, or PM2. If using Docker, adapt `services/docker-compose.hetzner.yml` per host.

### Match host

```bash
ssh root@<match-host>
mkdir -p /opt/mgx/services /opt/fhs-server
```

Upload files:

```bash
scp -r services/node-agent root@<match-host>:/opt/mgx/services/
scp services/node-agent/.env root@<match-host>:/opt/mgx/services/node-agent/.env
scp -r <your-unity-linux-build>/* root@<match-host>:/opt/fhs-server/
```

Install and run:

```bash
ssh root@<match-host>
cd /opt/mgx/services/node-agent
npm ci
node src/index.js
```

After changing callback or auth env values, restart the service:

```bash
sudo systemctl restart node-agent
```

## 5. Validate local config before deploy

```bash
npm run live-league:env:check
cmd /c .\\node_modules\\.bin\\tsc -b
cd src/functions && npm run build
cd ../..
node --check services/match-control-api/src/index.js
```

## 6. Deploy Firebase functions

Recommended path:

```bash
firebase use staging
firebase deploy --only functions
```

For production:

```bash
firebase use prod
firebase deploy --only functions
```

Firebase CLI will load:
- `src/functions/.env`
- and project-specific `src/functions/.env.<alias>` if present

## 7. Validate HTTP endpoints

From your local machine:

```bash
curl https://match-control-staging.example.com/health
curl -H "Authorization: Bearer <MATCH_CONTROL_SECRET>" https://match-control-staging.example.com/v1/matches/non-existent/status
```

From API host to each node:

```bash
curl -H "Authorization: Bearer <NODE_AGENT_SECRET>" http://10.0.1.11:9090/health
```

## 8. Release gate

Do not continue to production unless all are true:

- `prepareLeagueKickoffWindow` writes `live.state=warm`
- `kickoffPreparedLeagueMatches` starts all prepared matches
- `reconcileLeagueLiveMatches` updates stuck fixtures
- `backfillLiveLeagueMedia` recovers at least one forced missing-media scenario
- `/admin/live-league` loads without auth or Firestore errors for an admin user
- One real Android client joins and reconnects to a live league match
