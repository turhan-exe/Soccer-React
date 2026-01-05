FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libglib2.0-0 libsm6 libxext6 libxrandr2 libxcursor1 libxi6 libxinerama1 \
    ffmpeg xvfb x11-utils mesa-utils ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built render player (place your build outputs next to this Dockerfile before building the image)
COPY OSMRender.x86_64 .
COPY OSMRender_Data ./OSMRender_Data
COPY UnityPlayer.so ./
COPY GameAssembly.so ./

RUN chmod +x /app/OSMRender.x86_64

ENV MATCH_ID=""
ENV LEAGUE_ID=""
ENV SEASON_ID=""
ENV REPLAY_PATH=""
ENV VIDEO_PATH=""
ENV REPLAY_URL=""
ENV VIDEO_UPLOAD_URL=""

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
COPY entrypoint_setup.sh /app/entrypoint_setup.sh
RUN chmod +x /app/entrypoint_setup.sh

CMD ["/app/entrypoint.sh"]
