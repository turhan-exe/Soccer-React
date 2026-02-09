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
