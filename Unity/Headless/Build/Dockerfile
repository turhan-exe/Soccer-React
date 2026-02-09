FROM ubuntu:22.04

# Unity runtime için tipik bağımlılıklar (eksik lib hatası alırsan burası işe yarar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libglib2.0-0 \
    libstdc++6 \
    libgcc-s1 \
    libz1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Unity build çıktısı
COPY OSMHeadless.x86_64 /app/OSMHeadless.x86_64
COPY OSMHeadless_Data   /app/OSMHeadless_Data
COPY UnityPlayer.so     /app/UnityPlayer.so
COPY GameAssembly.so    /app/GameAssembly.so

RUN chmod +x /app/OSMHeadless.x86_64

# Headless çalıştırma
ENTRYPOINT ["/app/OSMHeadless.x86_64","-batchmode","-nographics"]
