# Callback Token Sync Runbook

This runbook fixes `401 invalid_callback_token` errors between `match-control-api` and `node-agent`.

## Why this matters

These flows all call the internal lifecycle endpoint:
- node-agent -> match-control callback (`/v1/internal/matches/:matchId/lifecycle`)
- load test cleanup (`--cleanup`) -> same endpoint
- manual cleanup curl calls -> same endpoint

All of them must use the same `MATCH_CONTROL_CALLBACK_TOKEN`.

If not aligned:
- prepare and kickoff can still return `200`
- but lifecycle updates fail
- matches remain stuck (`warm`, `server_started`, `running`)

## Token must match in 3 places

1. API host:
- `/opt/mgx/services/match-control-api/.env`
- key: `MATCH_CONTROL_CALLBACK_TOKEN`

2. Every match node:
- `/opt/mgx/services/node-agent/.env`
- key: `MATCH_CONTROL_CALLBACK_TOKEN`

3. Any local cleanup / test call:
- load test flag `--callback-token`
- manual curl `Authorization: Bearer <MATCH_CONTROL_CALLBACK_TOKEN>`

## Apply on API host

```bash
ssh root@<api-public-ip>
cd /opt/mgx/services/match-control-api
grep '^MATCH_CONTROL_CALLBACK_TOKEN=' .env
```

Set token:

```bash
sudo sed -i "s|^MATCH_CONTROL_CALLBACK_TOKEN=.*|MATCH_CONTROL_CALLBACK_TOKEN=<TOKEN>|" /opt/mgx/services/match-control-api/.env
```

Restart:

```bash
sudo systemctl restart match-control-api
sudo systemctl status match-control-api --no-pager
```

## Apply on each match node

```bash
ssh root@<match-node-public-ip>
cd /opt/mgx/services/node-agent
grep '^MATCH_CONTROL_CALLBACK_TOKEN=' .env
```

Set token:

```bash
sudo sed -i "s|^MATCH_CONTROL_CALLBACK_TOKEN=.*|MATCH_CONTROL_CALLBACK_TOKEN=<TOKEN>|" /opt/mgx/services/node-agent/.env
```

Restart:

```bash
sudo systemctl restart node-agent
sudo systemctl status node-agent --no-pager
```

## Quick verification

From your own machine:

```bash
curl "http://<api-public-ip>:8080/health"
```

Expected:
- `ok: true`

Then run one smoke load test with cleanup:

```bash
npm run live-league:load -- --count 1 --parallel 1 --kickoff --cleanup --base-url http://<api-public-ip>:8080 --secret <MATCH_CONTROL_SECRET> --callback-token <MATCH_CONTROL_CALLBACK_TOKEN>
```

Expected:
- `cleanup.failed = 0`
- no `invalid_callback_token` in response logs

## Clean up a stuck match manually

```bash
curl -X POST "http://<api-public-ip>:8080/v1/internal/matches/<MATCH_ID>/lifecycle" \
  -H "Authorization: Bearer <MATCH_CONTROL_CALLBACK_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"matchId\":\"<MATCH_ID>\",\"fixtureId\":\"<FIXTURE_ID>\",\"leagueId\":\"<LEAGUE_ID>\",\"state\":\"failed\",\"reason\":\"manual_cleanup\"}"
```
