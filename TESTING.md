E2E Test Plan (Step 10)

Prereqs
- Firebase emulators running for Firestore, Functions, Storage and Realtime DB
- Functions config secrets set in emulator env if you test HTTP-auth endpoints:
  - orchestrate.secret (used by orchestrate19TRT)

Start emulators

  firebase emulators:start --only firestore,functions,storage,database,hosting

Seed minimal data

  # from repo root or src/functions
  cd src/functions
  PROJECT_ID=demo-osm-react node src/functions/scripts/seed.mjs M001

Happy path (lock -> start -> live -> finalize)

  # Ensure you export ORCH_SECRET matching functions:config:set orchestrate.secret
  # Windows PowerShell example:
  #   $env:ORCH_SECRET="YOUR_SECRET"
  #   $env:PROJECT_ID="demo-osm-react"

  npm run -w ./src/functions e2e:happy

What e2e:happy does
- Seeds league L-TR-1-2025a, teams T001/T002 and fixture M001 at today 19:00 TR
- Calls lockWindowSnapshot (idempotent) to create matchPlans/M001
- Calls orchestrate19TRT with bearer secret; sets fixture to running
- Pushes two live events to RTDB live/M001/events
- Uploads results JSON to Storage results/2025a/L-TR-1-2025a/M001.json to trigger onResultFinalize
- Verifies fixture becomes played and replayPath is set

Retry & Poison (watchdog)
- startMatch, ardından finalize gelmezse watchdog devreye girmesi için ayarlıdır.
- Varsayılan gecikme 20 dk (FINALIZE_WATCHDOG_DELAY_SEC). Emülatörde hızlandırmak için:

  WINDOWS PowerShell (örnek)
    $env:FINALIZE_WATCHDOG_DELAY_SEC="15"
    $env:FINALIZE_MAX_RETRIES="3"

- startMatch sonrası 15 sn içinde finalize gelmezse yeniden dispatch dener; 3. denemeden sonra:
  - fixtures status -> failed
  - failedJobs/{matchId}
  - Slack bildirimi (env/config gerektirir)

Manual helpers

  # Push two live events
  npm run -w ./src/functions push-live

  # Trigger finalize by uploading a sample results JSON
  npm run -w ./src/functions finalize:sample

Replay URL
- Use callable getReplay from the app to get a signed URL for the replayPath.
- When testing manually, Storage emulator exposes files at http://127.0.0.1:9199/v0/b/<bucket>/o/<path>

Security checks (rules)
- Firestore: writing to fixtures/matchPlans from client is denied
- RTDB: live/* write is denied for clients, read allowed for auth != null
- Storage: replays/* readable for auth users (json/json.gz), results/* not readable/writable by clients

## Team Planning Slot Recommendations

1. Pitch üzerinde herhangi bir slotu (dolu veya boş) seçince sağ panelde ilgili alan adının (ör. `santrafor`) göründüğünü doğrula.
2. Yanlış pozisyona sürüklenmiş bir oyuncuyu (ör. stoperi forvet slotuna koy) seçtiğinde öneri listesinin hâlâ slotun hedef rolüne (santrafor) göre geldiğini kontrol et.
3. Boş bir slotu seçtikten sonra önerilen bench oyuncularından birini ekle; oyuncunun doğrudan slot koordinatına yerleştiğini ve panelde yeni oyuncunun seçili olduğunu doğrula.
4. Aynı slot için farklı oyuncuları art arda seç; `recommendPlayers` listesinin slot kimliğine göre sabit kaldığını (oyuncunun kimliğine göre değişmediğini) test et.
