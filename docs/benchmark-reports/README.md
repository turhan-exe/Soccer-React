# Benchmark Reports

Store every staging benchmark and acceptance artifact in this folder.

Recommended filenames:

- `live-league-2026-03-04-load.json`
- `live-league-2026-03-04-prewarm.json`
- `live-league-2026-03-04-kickoff.json`
- `live-league-2026-03-04-final.json`
- `live-league-2026-03-04-summary.md`

Suggested commands:

```bash
npm run live-league:load -- --count 200 --parallel 25 --kickoff --cleanup --out docs/benchmark-reports/live-league-2026-03-04-load.json
npm run live-league:staging -- --date 2026-03-04 --mode prewarm --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-prewarm.json
npm run live-league:staging -- --date 2026-03-04 --mode kickoff --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-kickoff.json
npm run live-league:staging -- --date 2026-03-04 --mode final --service-account C:\Users\TURHAN\Desktop\MGX\secrets\live-league\osm-react-firebase-adminsdk-fbsvc-fb46fd719a.json --out docs/benchmark-reports/live-league-2026-03-04-final.json
```
