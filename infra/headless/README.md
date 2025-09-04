Unity Headless Worker (OSM)

Overview
- Headless Unity job reads a signed batch JSON, simulates matches deterministically, uploads replay and result JSON via signed PUT, and optionally posts live events to Functions.

Code Layout
- `Unity/Headless/Assets/Scripts/*`: C# runtime (batch fetch, sim, upload).
- `Unity/Headless/Build/Dockerfile`: Container for Cloud Run Jobs.

Environment
- `BATCH_URL`: Signed GET to `jobs/<day>/batch_<day>.json`.
- `EMIT_LIVE_URL`, `END_LIVE_URL`: Functions endpoints for live events (optional).
- `LIVE_SECRET`: Bearer token for live endpoints.
- `RESULTS_CALLBACK_URL`, `RESULTS_SECRET`: Optional finalize callback.

Build & Run
1) Build Linux Server in Unity to `Unity/Headless/Build/` as `OSMHeadless.x86_64` + `OSMHeadless_Data/`.
2) Build container:
   docker build -t gcr.io/PROJECT/unity-sim:latest Unity/Headless/Build
3) Push and create Cloud Run Job with env vars.

