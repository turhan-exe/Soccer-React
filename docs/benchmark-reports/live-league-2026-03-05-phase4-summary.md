# Live League Phase 4 Summary (2026-03-05)

## Slot Load Tests (`count=40`, `parallel=10`)

| Slot | Total | Prepare p95 (ms) | Prepare max (ms) | Kickoff p95 (ms) | Kickoff max (ms) | Cleanup |
|---|---:|---:|---:|---:|---:|---|
| 12:00 | 40 | 302 | 314 | 105 | 117 | true |
| 15:00 | 40 | 474 | 485 | 106 | 122 | true |
| 16:00 | 40 | 397 | 400 | 166 | 167 | true |
| 17:00 | 40 | 628 | 628 | 95 | 95 | true |
| 18:00 | 40 | 270 | 271 | 144 | 144 | true |
| 19:00 | 40 | 320 | 330 | 160 | 172 | true |

## Acceptance Rerun (`prepare-http` + `kickoff-http` + `staging prewarm/kickoff/final`)

| Slot | Fixture Total | Prepared | Prepare Failed | Kickoff Started | Kickoff Failed | Final Played | Final Failed | Final `withLiveMatchId` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 12:00 | 24 | 24 | 0 | 24 | 0 | 0 | 0 | 24 |
| 15:00 | 32 | 32 | 0 | 32 | 0 | 0 | 0 | 32 |
| 16:00 | 32 | 32 | 0 | 32 | 0 | 0 | 0 | 32 |
| 17:00 | 32 | 32 | 0 | 32 | 0 | 0 | 0 | 32 |
| 18:00 | 40 | 40 | 0 | 40 | 0 | 0 | 0 | 40 |
| 19:00 | 40 | 40 | 0 | 40 | 0 | 0 | 0 | 40 |

## Root Causes Fixed

1. Manual HTTP catchup flow selected no targets for explicit slot hour because it still applied realtime window logic.
   - Fix: explicit `kickoffHour` now bypasses realtime windows in `resolvePrepareKickoffTargets` and `resolveKickoffTargets`.
2. `prepare_failed` on 16/17/18 slots due Firestore write error: `home/away.formation` was `undefined` in `matchPlans`.
   - Fix: `formation` now writes string or `null`, never `undefined`.

## Operational Notes

- Final step still reports `played=0` in this staging flow because Unity result/replay/video completion path was not awaited in this acceptance cycle.
- Slot-by-slot rerun used cleanup + fixture reset + node restart between slots to avoid stale allocations.
- New helper scripts:
  - `scripts/live-league-cleanup-matches.mjs`
  - `scripts/live-league-report-live-reasons.mjs`
