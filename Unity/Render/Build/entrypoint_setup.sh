#!/bin/bash
set -e

echo "[entrypoint] Setting up Render FIFO..."

FIFO_PATH=${RENDER_PIPE_PATH:-/tmp/render.pipe}
if [ -e "$FIFO_PATH" ]; then
    rm "$FIFO_PATH"
fi
mkfifo "$FIFO_PATH"
chmod 666 "$FIFO_PATH"
echo "[entrypoint] Created FIFO at $FIFO_PATH"

WIDTH=${RENDER_WIDTH:-1920}
HEIGHT=${RENDER_HEIGHT:-1080}
FPS=${RENDER_FPS:-20}
PIX_FMT=${RENDER_PIX_FMT:-rgb24}

echo "[entrypoint] Starting ffmpeg background process... Res=${WIDTH}x${HEIGHT} FPS=${FPS} PIX_FMT=${PIX_FMT}"

which ffmpeg || echo "ffmpeg not found in PATH"
ffmpeg -version | head -n 1

echo "[entrypoint] FFmpeg CMD: /usr/bin/ffmpeg -y -f rawvideo -pix_fmt ${PIX_FMT} -s ${WIDTH}x${HEIGHT} -r ${FPS} -i $FIFO_PATH -an -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p /tmp/render.mp4"

/usr/bin/ffmpeg -y -f rawvideo -pix_fmt ${PIX_FMT} -s ${WIDTH}x${HEIGHT} -r ${FPS} \
    -i "$FIFO_PATH" -an -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
    /tmp/render.mp4 > /tmp/ffmpeg.log 2>&1 &

FFMPEG_PID=$!
export FFMPEG_PID
echo "[entrypoint] ffmpeg started with PID=$FFMPEG_PID"
