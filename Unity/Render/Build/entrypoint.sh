#!/bin/sh
set -eu

echo "[entrypoint] render start $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "[entrypoint] uname=$(uname -a)"
echo "[entrypoint] pwd=$(pwd)"
echo "[entrypoint] id=$(id -u):$(id -g)"
ls -l /app
if command -v ldd >/dev/null 2>&1; then
  ldd /app/OSMRender.x86_64 || true
fi
echo "[entrypoint] MATCH_ID=${MATCH_ID} LEAGUE_ID=${LEAGUE_ID} SEASON_ID=${SEASON_ID}"
# Export Render/Fast Mode environment variables
export RENDER_FAST="${RENDER_FAST:-true}"
export RENDER_CROWD="${RENDER_CROWD:-0}"
export RENDER_UI="${RENDER_UI:-0}"
export UNITY_VIDEO_RECORDING="true"

echo "[entrypoint] DEBUG: RENDER_FAST='$RENDER_FAST' RENDER_CROWD='$RENDER_CROWD' RENDER_UI='$RENDER_UI' UNITY_VIDEO_RECORDING='$UNITY_VIDEO_RECORDING'"

if [ -n "${REPLAY_URL:-}" ]; then
  echo "[entrypoint] REPLAY_URL set"
  if command -v curl >/dev/null 2>&1; then
    echo "[entrypoint] REPLAY_URL head test"
    curl -I --max-time 15 "$REPLAY_URL" || true
  fi
else
  echo "[entrypoint] REPLAY_URL missing"
fi

if [ -n "${VIDEO_UPLOAD_URL:-}" ]; then
  echo "[entrypoint] VIDEO_UPLOAD_URL set"
else
  echo "[entrypoint] VIDEO_UPLOAD_URL missing"
fi

if [ -f /app/entrypoint_setup.sh ]; then
  . /app/entrypoint_setup.sh
else
  echo "[entrypoint] entrypoint_setup.sh missing"
  exit 1
fi

echo "[entrypoint] starting unity render..."
xvfb-run -a -s "-screen 0 1920x1080x24" \
  /app/OSMRender.x86_64 \
  -batchmode \
  -force-glcore \
  -logFile /dev/stdout \
  -quit
rc=$?
echo "[entrypoint] unity exit code=$rc"
ffmpeg_rc=0
if [ -n "${FFMPEG_PID:-}" ]; then
  echo "[entrypoint] waiting ffmpeg pid=$FFMPEG_PID (max 120 seconds)"
  
  # Wait for FFmpeg with timeout
  timeout_counter=0
  max_timeout=120
  while kill -0 $FFMPEG_PID 2>/dev/null; do
    if [ $timeout_counter -ge $max_timeout ]; then
      echo "[entrypoint] FFmpeg timeout after ${max_timeout}s, killing process"
      kill -9 $FFMPEG_PID 2>/dev/null || true
      ffmpeg_rc=124  # Standard timeout exit code
      break
    fi
    sleep 1
    timeout_counter=$((timeout_counter + 1))
  done
  
  if [ $ffmpeg_rc -eq 0 ]; then
    wait $FFMPEG_PID || ffmpeg_rc=$?
    echo "[entrypoint] ffmpeg exit code=$ffmpeg_rc (finished in ${timeout_counter}s)"
  fi
fi
if [ -f /tmp/render.mp4 ]; then
  size=$(stat -c%s /tmp/render.mp4 2>/dev/null || wc -c < /tmp/render.mp4)
  echo "[entrypoint] render output size=$size bytes"

  # Validate video file is not empty
  if [ "$size" -eq 0 ]; then
    echo "[entrypoint] ERROR: Video file is empty (0 bytes)"
    rc=1
  else
    echo "[entrypoint] Video file validated (size > 0)"
    
    # NATIVE UPLOAD: Upload video using curl if URL is provided
    if [ -n "${VIDEO_UPLOAD_URL:-}" ]; then
       echo "[entrypoint] Starting native upload via curl..."
       echo "[entrypoint] Upload size: $size bytes (~$((size / 1024 / 1024)) MB)"
       
       # Perform upload with detailed error reporting
       if curl -X PUT -T /tmp/render.mp4 \
               -H "Content-Type: video/mp4" \
               --fail \
               --retry 3 \
               --retry-delay 2 \
               --max-time 600 \
               --progress-bar \
               "$VIDEO_UPLOAD_URL" 2>&1 | tee /tmp/curl.log; then
          echo "[entrypoint] ✓ Native Upload Success"
          rc=0
       else
          curl_exit=$?
          echo "[entrypoint] ✗ Native Upload Failed (curl exit code: $curl_exit)"
          if [ -f /tmp/curl.log ]; then
            echo "[entrypoint] Curl output:"
            cat /tmp/curl.log
          fi
          rc=1
       fi
    else
       echo "[entrypoint] No VIDEO_UPLOAD_URL provided, skipping upload"
       # If no upload URL, consider it success if video exists
       rc=0
    fi
  fi
else
  echo "[entrypoint] render output missing"
  if [ -f /tmp/ffmpeg.log ]; then
    echo "[entrypoint] ffmpeg log tail"
    tail -n 200 /tmp/ffmpeg.log || true
  fi
fi
if [ $rc -eq 0 ] && [ ${ffmpeg_rc:-0} -ne 0 ]; then
  rc=$ffmpeg_rc
fi
exit $rc
