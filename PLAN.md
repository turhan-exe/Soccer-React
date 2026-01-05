# Plan: Cloud Run Jobs simulation + render pipeline

## Requirements
- 19:00'da tum lig maclari Unity simulasyonunda oynatilacak.
- Simulasyon sonucu requestToken dogrulamasi gececek.
- Video mp4 ayri render job'da uretilecek ve Storage'a yuklenecek.
- Video metadata fixtures uzerinde tutulacak; kullanici video izleyebilecek.

## Scope
In:
- Batch uretimi, simulasyon job'lari, render job kuyrugu, Firestore metadata, scheduler/ops.
Out:
- UI tasarim degisiklikleri, replay formatinin yeniden tasarimi.

## Files and entry points
- createBatch.ts
- scheduler.ts
- orchestrate19trt.ts
- runner.ts
- Dtos.cs
- HeadlessEntry.cs
- ReplaySerializer.cs
- Unity/Headless/Build/Dockerfile
- Unity/Render (yeni build yolu)
- onResultFinalize.ts
- onMatchVideoFinalize.ts
- getMatchVideo.ts
- replays.ts
- MatchVideoPage.tsx
- MatchesHistoryPage.tsx
- README.md
- infra/scheduler.md

## Data model / API changes
- Result JSON'a requestToken eklenmesi.
- Video metadata fixtures uzerinde tutulmasi.
- Video path formatinin fixtures ile eslesmesi (onerilen: {matchId}.mp4).

## Action items
- [ ] 19:00 akisina tek otorite: runDailyMatches ve runDailyMatchesAt19TR devre disi; Unity batch job tek kaynak.
- [ ] createDailyBatchInternal 16 shard uretsin; her shard icin batchReadUrl uretsin.
- [ ] kickUnityJob her shard icin Cloud Run Job baslatsin (16 job).
- [ ] Unity DTO guncelle: requestToken alani Dtos.cs ve ReplaySerializer.ResultToJson icine eklensin.
- [ ] Sim job replay/result upload yapsin; video uretmesin.
- [ ] onResultFinalize her mac icin render job kuyruga alsin (hedef 16 eszamanli).
- [ ] Render job altyapisi: Unity render build Unity/Render, FFmpeg + sanal display + GPU.
- [ ] Fixtures metadata guncelle: onResultFinalize -> videoMissing: true, video.storagePath; onMatchVideoFinalize -> video.uploaded: true.
- [ ] getMatchVideo ve UI fixtures uzerinden calissin.
- [ ] Loglama ve izleme: sim job, render job, upload status, requestToken dogrulama.

## Testing and validation
- 16 shard batch dogru mu?
- Sim job replay/result uretiyor mu?
- Render job mp4 uretip Storage'a yaziyor mu?
- Fixtures metadata guncelleniyor mu?
- UI video oynatiyor mu?

## Risks and edge cases
- Scheduler cakismalari (random sim akisi) Unity akisina zarar verebilir.
- Render job GPU/FFmpeg yoksa video uretilemez.
- Video path fixtures ile uyumsuzsa izleme kirilir.
