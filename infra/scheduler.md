Cloud Scheduler ve Secrets Kurulumu (Europe/Istanbul)

Önkoşullar
- gcloud, firebase-tools yüklü ve projeye yetkili.
- Functions `orchestrate19TRT`, `cronWatchdog`, (opsiyonel) `cronCreateBatch`, `kickUnityJob` deploy edilmiş.

1) Functions config (secrets)

```bash
# Proje seç
gcloud config set project <PROJECT_ID>

# Secrets (aynı değeri kullanabilirsin)
export SECRET="$(openssl rand -hex 24)"

firebase functions:config:set \
  orchestrate.secret="$SECRET" \
  scheduler.secret="$SECRET" \
  lock.secret="$SECRET" \
  start.secret="$SECRET" \
  results.secret="$SECRET" \
  unity.result_secret="$SECRET" \
  unity.secret="$SECRET" \
  render.secret="$SECRET" \
  alert.slack_webhook="https://hooks.slack.com/services/XXX/YYY/ZZZ"

# Doğrula
firebase functions:config:get
```

2) Cloud Scheduler işleri

Fonksiyon URL’leri (1st gen):
- orchestrate19TRT: https://europe-west1-<PROJECT_ID>.cloudfunctions.net/orchestrate19TRT
- cronWatchdog:     https://europe-west1-<PROJECT_ID>.cloudfunctions.net/cronWatchdog
- (opsiyonel) cronCreateBatch: https://europe-west1-<PROJECT_ID>.cloudfunctions.net/cronCreateBatch
- (opsiyonel) kickUnityJob:    https://europe-west1-<PROJECT_ID>.cloudfunctions.net/kickUnityJob

```bash
# 19:00 TRT — orchestrate
gcloud scheduler jobs create http orchestrate-19trt \
  --location=europe-west1 \
  --schedule="0 19 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://europe-west1-<PROJECT_ID>.cloudfunctions.net/orchestrate19TRT" \
  --http-method=GET \
  --headers="Authorization=Bearer $SECRET"

# 19:10 TRT — watchdog
gcloud scheduler jobs create http watchdog-1910 \
  --location=europe-west1 \
  --schedule="10 19 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://europe-west1-<PROJECT_ID>.cloudfunctions.net/cronWatchdog" \
  --http-method=GET \
  --headers="Authorization=Bearer $SECRET"

# 18:30 TRT — lockWindowSnapshot (kadro kilidi/snapshot)
gcloud scheduler jobs create http lock-window-1830 \
  --location=europe-west1 \
  --schedule="30 18 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://europe-west1-<PROJECT_ID>.cloudfunctions.net/lockWindowSnapshot" \
  --http-method=GET \
  --headers="Authorization=Bearer $SECRET"

# (Opsiyonel) 18:00 — günlük batch oluşturma
gcloud scheduler jobs create http cron-create-batch-1800 \
  --location=europe-west1 \
  --schedule="0 18 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://europe-west1-<PROJECT_ID>.cloudfunctions.net/cronCreateBatch" \
  --http-method=GET \
  --headers="Authorization=Bearer $SECRET"

# (Opsiyonel) 18:30 — Unity Cloud Run job tetikleme
gcloud scheduler jobs create http kick-unity-job-1830 \
  --location=europe-west1 \
  --schedule="30 18 * * *" \
  --time-zone="Europe/Istanbul" \
  --uri="https://europe-west1-<PROJECT_ID>.cloudfunctions.net/kickUnityJob" \
  --http-method=GET \
  --headers="Authorization=Bearer $SECRET"

# Çalıştırmayı test et
gcloud scheduler jobs run orchestrate-19trt --location=europe-west1
gcloud scheduler jobs run watchdog-1910 --location=europe-west1
```

3) Cloud Tasks kuyruğu (startMatch için — opsiyonel)

```bash
gcloud tasks queues create start-match --location=europe-west1 \
  --max-attempts=3 --max-dispatches-per-second=50

# Mevcutsa güncellemek için:
gcloud tasks queues update start-match --location=europe-west1 \
  --max-attempts=3 --max-dispatches-per-second=50

# Sharding (yük tepesinde):
# ORCH_MODE=TASKS ve TASKS_SHARDS=N ile şubelemek için N adet kuyruk oluştur:
# örn. start-match-0 .. start-match-3
for i in 0 1 2 3; do \
  gcloud tasks queues create start-match-$i --location=europe-west1 --max-attempts=3 --max-dispatches-per-second=50 || true; \
done

# Render video queue (target 16 concurrent)
gcloud tasks queues create render-video --location=europe-west1 \
  --max-attempts=3 --max-dispatches-per-second=16 --max-concurrent-dispatches=16
```

4) Deploy ve doğrulama

```bash
cd src/functions
npm i
npm run build
firebase deploy --only functions

# Heartbeat dokümanı kontrol (Firestore)
# ops_heartbeats/{yyyy-mm-dd} altında orchestrateOk/matchesScheduled alanlarını görmelisin.
```

Notlar
- Scheduler sırf Authorization header ile yetkilendiriliyor; secret rotasyonu için yukarıdaki config’i tekrar set edebilirsin.
- İstersen OIDC ile servis hesabı tabanlı doğrulamaya geçebilirsin; mevcut kod Bearer secret beklediği için header yöntemi kullanılmaktadır.
- (Opsiyonel) RTDB event sharding: yüksek izleyici için Functions ortamına `LIVE_SHARDS=N` set edebilirsin. Sunucu yazımı `live/{matchId}/events` yanında `events_s{0..N-1}` altında da çoğaltır; istemci parçalı okumaya geçtiğinde bu şube kullanılabilir.

Ek Notlar
- Unity batch sharding icin UNITY_SHARDS veya BATCH_SHARDS env ayarini Cloud Run Job tarafinda belirle.
- Legacy cron runner kapatmak icin LEGACY_RUNNER_DISABLED=1 (varsayilan: 1).
