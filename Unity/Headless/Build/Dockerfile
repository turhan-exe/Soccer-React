FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libglib2.0-0 libsm6 libxext6 libxrandr2 libxcursor1 libxi6 libxinerama1 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built headless server (place your build outputs next to this Dockerfile before building the image)
COPY OSMHeadless.x86_64 .
COPY OSMHeadless_Data ./OSMHeadless_Data
COPY UnityPlayer.so ./

ENV BATCH_URL=""
ENV EMIT_LIVE_URL=""
ENV END_LIVE_URL=""
ENV LIVE_SECRET=""
ENV RESULTS_CALLBACK_URL=""
ENV RESULTS_SECRET=""

CMD ["/app/OSMHeadless.x86_64", "-batchmode", "-nographics", "-quit"]

