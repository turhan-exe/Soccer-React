#!/usr/bin/env bash
set -euo pipefail

NODE_SECRET="${1:-}"
if [[ -z "$NODE_SECRET" ]]; then
  echo "usage: $0 <NODE_AGENT_SECRET>"
  exit 1
fi

API_DIR="/opt/football-manager-ui/services/match-control-api"
API_ENV="$API_DIR/.env"
API_SRC="$API_DIR/src/index.js"
API_LOG="/var/log/match-control-api.log"

if [[ ! -f "$API_ENV" ]]; then
  echo "ERROR: $API_ENV not found"
  exit 1
fi

if [[ ! -f "$API_SRC" ]]; then
  echo "ERROR: $API_SRC not found"
  exit 1
fi

if ! grep -q "nodeAgentsFriendly" "$API_SRC"; then
  echo "ERROR: match-control-api source is old. Copy latest src/index.js first."
  exit 1
fi

sudo cp "$API_ENV" "$API_ENV.bak.$(date +%Y%m%d-%H%M%S)"
sudo sed -i '/^NODE_AGENTS_LEAGUE=/d' "$API_ENV"

LEAGUE_NODE_IPS="${LEAGUE_NODE_IPS:-10.0.0.4,10.0.0.5,10.0.0.6,10.0.0.7,10.0.0.8}"
IFS=',' read -r -a IPS <<< "$LEAGUE_NODE_IPS"

LEAGUE_JSON="["
NODE_INDEX=1
for RAW_IP in "${IPS[@]}"; do
  IP="$(echo "$RAW_IP" | xargs)"
  if [[ -z "$IP" ]]; then
    continue
  fi
  NODE_ID="$(printf 'league-%02d' "$NODE_INDEX")"
  ENTRY="{\"id\":\"$NODE_ID\",\"url\":\"http://$IP:9090\",\"token\":\"$NODE_SECRET\"}"
  if [[ "$LEAGUE_JSON" != "[" ]]; then
    LEAGUE_JSON+=","
  fi
  LEAGUE_JSON+="$ENTRY"
  NODE_INDEX=$((NODE_INDEX + 1))
done
LEAGUE_JSON+="]"

if [[ "$NODE_INDEX" -le 1 ]]; then
  echo "ERROR: LEAGUE_NODE_IPS resolved to empty list"
  exit 1
fi

printf 'NODE_AGENTS_LEAGUE=%s\n' "$LEAGUE_JSON" | sudo tee -a "$API_ENV" >/dev/null

echo "---- env check ----"
grep -E '^NODE_AGENTS_FRIENDLY=|^NODE_AGENTS_LEAGUE=' "$API_ENV" || true

echo "---- deps ----"
cd "$API_DIR"
if [[ -f "package-lock.json" ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "---- restart ----"
sudo fuser -k 8080/tcp || true
nohup node src/index.js >"$API_LOG" 2>&1 &
sleep 2

echo "---- process check ----"
ss -ltnp | grep ':8080' || {
  echo "ERROR: nothing is listening on :8080"
  tail -n 60 "$API_LOG" || true
  exit 1
}

echo "---- health ----"
HEALTH_JSON="$(curl -fsS http://127.0.0.1:8080/health)"
echo "$HEALTH_JSON"

if ! echo "$HEALTH_JSON" | grep -q '"nodeAgentsFriendly"'; then
  echo "ERROR: new health fields are missing (old process/source)"
  exit 1
fi

if ! echo "$HEALTH_JSON" | grep -q '"nodeAgentsLeague"'; then
  echo "ERROR: league pool health field missing"
  exit 1
fi

echo "OK: control API is up with dedicated pools."
