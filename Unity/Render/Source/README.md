# Unity Render Pipeline (Source)

These scripts implement a clean replay->video pipeline using GPU blit + AsyncGPUReadback,
writing raw frames into the FIFO created by the render job (`/tmp/render.pipe` by default).

## How to integrate
- Copy `Unity/Render/Source/Scripts` into your Unity Render project (e.g. `Assets/RenderPipeline`).
- Add `ReplayFrameApplier` to a scene object and wire:
  - `ballTransform`
  - `playerActors` (id -> Transform)
- (Optional) Add `RenderSceneToggles` to wire UI/Crowd roots for fast/headless renders.
- Ensure a render camera exists (tagged `MainCamera` or named via `RENDER_CAMERA_NAME`).
- Build the Linux headless render player as usual.

## Environment variables
- Input
  - `REPLAY_URL` (signed URL to replay JSON)
  - `REPLAY_PATH` (local JSON path, optional)
  - `REPLAY_JSON` (inline JSON, optional)
- Capture
  - `RENDER_WIDTH` / `RENDER_HEIGHT` (default 1920x1080)
  - `RENDER_FPS` (default 20)
  - `RENDER_PIX_FMT` (`rgb24` default, or `rgba`)
  - `RENDER_PIPE_PATH` (default `/tmp/render.pipe`)
  - `RENDER_FLIP_Y=1` to fix upside-down frames
  - `RENDER_FLIP_X=1` to mirror horizontally (optional)
  - `RENDER_WARMUP_FRAMES` (default 2)
  - `RENDER_SKIP_FRAMES` (default 0)
  - `RENDER_END_PADDING_MS` (default 0)
  - `RENDER_MAX_FRAMES` (default 0 = no limit)
- Visual toggles
  - `RENDER_FAST` (default true)
  - `RENDER_UI` (default false)
  - `RENDER_CROWD` (default false)
- Debug
  - `RENDER_DEBUG_FRAMES=1`

## Notes
- These scripts do not touch `Unity/Render/Build/FHS_*` directories.
- If you need to change the FIFO or pixel format in the container,
  update `Unity/Render/Build/entrypoint_setup.sh` accordingly.

## Online match end sync (Mirror)
- `MatchEndReplicator` is a Mirror `NetworkBehaviour` that distributes server-authoritative
  match-end state to clients.
- Place it once in the scene on a `NetworkIdentity` object.
- Recommended flow:
  1) Server/host calls `DeclareMatchEnded(...)` when final-whistle condition is satisfied.
  2) Clients receive `RpcMatchEnded(...)` and apply final-whistle locally once.
  3) `ClientFinalWhistleGuard` can remain enabled as a safety net against premature local end.
- If you cannot patch `MatchManager` directly, `MatchEndReplicator` can also auto-observe
  `MatchManager.MatchFlags` on server and replicate when it detects match completion.

## Dedicated server kickoff fallback
- `OnlineMatchStartGate` now includes an optional dedicated-server fallback:
  if the process is `batchmode`, role is `server` (`UNITY_MATCH_ROLE`/`MATCH_ROLE`),
  and no client is connected, it can invoke `MatchManager.StartMatchEngine()` by reflection.
- Default behavior is enabled and retry-based to avoid one-shot race conditions.
- Inspector knobs:
  - `forceStartEngineOnDedicatedServer`
  - `dedicatedStartAfterSeconds`
  - `dedicatedStartRetrySeconds`
  - `dedicatedServerRoleValue`

## Node-agent lifecycle bridge
- `NodeAgentLifecycleBridge` auto-creates at runtime and emits node-agent compatible logs:
  - minute heartbeat logs: `[NodeAgentLifecycleBridge] Minutes: <value>`
  - end marker log: `unityMatchFinished => { ...json... }`
- This is used by `services/node-agent` parser to push:
  - `running` state with minute heartbeats
  - `ended` state from parsed match result JSON
- Fallback behavior:
  - if `MatchEndReplicator` payload is not available but minute reaches configured threshold,
    a synthetic result line is emitted after a grace window.

## Dedicated build safety check
- `NodeAgentLifecycleBridge` and `OnlineMatchStartGate` must exist in the **actual Unity project you build** (the one that has `Assets/Code/...` scripts).
- Copying scripts only into this repository is not enough unless that Unity project includes them at build time.
- Before runtime deploy, run:
  - `.\scripts\live-league-deploy-runtime-fixes.ps1 -RepoRoot . -SkipControl -SkipNodes`
- This preflight now fails if dedicated build output is missing lifecycle hooks.
