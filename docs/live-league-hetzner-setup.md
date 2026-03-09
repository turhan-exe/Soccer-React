# Hetzner Live League Setup

This document explains the exact Hetzner Cloud clicks and values for staging.

Use the existing Hetzner project that already contains your live-league hosts whenever possible.
- In your current screenshots that project is `FHS-TEST`
- keep the staging API hosts, match nodes, private network, and firewalls inside that same Hetzner project
- create a separate Hetzner project only if you want billing and infrastructure isolation for production later

Important:
- the bigger isolation boundary is usually Firebase, not Hetzner
- if `staging` and `prod` Firebase aliases both point to the same Firebase project, manual catch-up and load tests will still mutate the same Firestore data even if Hetzner is separate

## 1. Create the private network

Site:
- `https://console.hetzner.cloud/`

Clicks:
- Open your Hetzner project
- Left menu: `Networks`
- Click `Create network`

Values:
- Name: `mgx-live-network`
- IP range: `10.0.0.0/16`
- Subnet: `10.0.1.0/24`
- Network zone: same zone as your servers

## 2. Create the API firewall

Clicks:
- Left menu: `Firewalls`
- Click `Create firewall`

Name:
- `mgx-live-api-fw`

Inbound rules:
- TCP `22` source: your office/home public IP
- TCP `8080` source: `0.0.0.0/0`

Attach to:
- Both `match-control-api` hosts

## 3. Create the match firewall

Name:
- `mgx-live-match-fw`

Inbound rules:
- TCP `22` source: your office/home public IP
- TCP `9090` source: `10.0.0.0/16`
- UDP `21001-21200` source: `0.0.0.0/0`

Attach to:
- Every match node host

## 4. Create the API servers

Clicks:
- Left menu: `Servers`
- `Create server`

Recommended staging values:
- Image: `Ubuntu 24.04`
- Type: `CPX31` or stronger
- Name: `mgx-match-control-a`
- Add to network: `mgx-live-network`
- Firewall: `mgx-live-api-fw`

Create a second API node:
- `mgx-match-control-b`

Recommended separation:
- `mgx-match-control-league` for league orchestration only
- `mgx-match-control-friendly` for friendly mode only
- this keeps friendly traffic stable when league concurrency spikes

## 5. Create the match nodes

For staging, start with at least:
- `4` match nodes for smoke tests

For full 200-match benchmark:
- enough nodes to reflect your intended density target

Recommended values:
- Image: `Ubuntu 24.04`
- Type: `CPX31` or stronger
- Names: `mgx-match-node-01`, `mgx-match-node-02`, ...
- Add to network: `mgx-live-network`
- Firewall: `mgx-live-match-fw`

## 6. Record the IP addresses

For each server, copy:
- Public IPv4
- Private network IP

You will use them in:
- `services/match-control-api/.env`
- `services/node-agent/.env`

Example:

```json
[
  { "id": "node-a", "url": "http://10.0.1.11:9090", "token": "<NODE_AGENT_SECRET>" },
  { "id": "node-b", "url": "http://10.0.1.12:9090", "token": "<NODE_AGENT_SECRET>" }
]
```

## 7. Upload the Unity Linux build

On each match node create:

```bash
mkdir -p /opt/fhs-server
```

Copy your Linux dedicated server build into:
- `/opt/fhs-server`

The key env fields are:
- `UNITY_SERVER_BINARY=/opt/fhs-server/FHS.x86_64`
- `UNITY_SERVER_WORKDIR=/opt/fhs-server`

## 8. Upload the Firebase admin JSON

On each API node:

```bash
mkdir -p /opt/mgx/secrets
```

Upload:
- `osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json`

Recommended destination:
- `/opt/mgx/secrets/firebase-admin.json`

Then set:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/opt/mgx/secrets/firebase-admin.json
```

## 9. Fill the env files with Hetzner values

### `services/match-control-api/.env`

Replace:
- `MATCH_CONTROL_CALLBACK_BASE_URL` with the API public URL or public IP and port
- `POSTGRES_URL` with the real staging database URL
- `REDIS_URL` with the real staging Redis URL
- Use dedicated pools:
  - `NODE_AGENTS_FRIENDLY` with friendly-only node private IP list
  - `NODE_AGENTS_LEAGUE` with league-only node private IP list
  - optional `NODE_AGENTS` can stay as fallback

For `25 leagues * 16 teams = 200` concurrent league matches:
- with `ALLOCATABLE_PORTS=21001,21002,21003` -> 3 slots per node
- minimum league nodes: `67`
- with 20% spare: `81` league nodes
- keep separate friendly nodes outside these 81

Generate pool JSON locally:

```bash
npm run live-league:pool -- --id-prefix league --token <NODE_AGENT_SECRET> --ips 10.0.1.11,10.0.1.12,10.0.1.13
```

Paste output into:
- `NODE_AGENTS_LEAGUE=...`

### `services/node-agent/.env`

Replace:
- `NODE_PUBLIC_IP` with that match node's public IP
- `NODE_PRIVATE_IP` with that match node's network IP
- `UNITY_SERVER_BINARY` with Linux binary path
- `UNITY_SERVER_WORKDIR` with Linux workdir path

## 10. Start the services

API node:

```bash
cd /opt/mgx/services/match-control-api
npm ci
node src/index.js
```

Match node:

```bash
cd /opt/mgx/services/node-agent
npm ci
node src/index.js
```

## 11. Health checks

From your own machine:

```bash
curl http://<api-public-ip>:8080/health
```

From API node to match node:

```bash
curl -H "Authorization: Bearer <NODE_AGENT_SECRET>" http://10.0.1.11:9090/health
```
