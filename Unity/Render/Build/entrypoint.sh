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
echo "[entrypoint] REPLAY_PATH=${REPLAY_PATH} VIDEO_PATH=${VIDEO_PATH}"

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
  -logFile /dev/stdout \
  -quit
rc=$?
echo "[entrypoint] unity exit code=$rc"
ffmpeg_rc=0
if [ -n "${FFMPEG_PID:-}" ]; then
  echo "[entrypoint] waiting ffmpeg pid=$FFMPEG_PID"
  wait $FFMPEG_PID || ffmpeg_rc=$?
  echo "[entrypoint] ffmpeg exit code=$ffmpeg_rc"
fi
if [ -f /tmp/render.mp4 ]; then
  size=$(stat -c%s /tmp/render.mp4 2>/dev/null || wc -c < /tmp/render.mp4)
  echo "[entrypoint] render output size=$size"
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
