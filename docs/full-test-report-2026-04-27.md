# Tam Proje Test Raporu - 2026-04-27

## Kapsam

Bu turda `football-manager-ui` ve Unity `FHS` tarafinda otomatik build/test, Android cihaz smoke testi, Android WebView route smoke testi ve Unity batchmode compile/import kontrolu yapildi.

Veri degistiren veya para harcatabilecek akislar otomatik tiklanmadi: Google Play satin alma, VIP/diamond satin alma, reklam izleme odulu alma, rastgele transfer satin alma, mac baslatma ve admin aksiyonlari. Bu alanlarda sayfa render/route/console kontrolu yapildi; fonksiyonel tiklama icin manuel test gerekir.

Test edilen cihaz:
- ADB device: `4TK7OVXOPVSGTCV4`
- Device model: `Xiaomi 2407FPN8EG`
- Android: `16`, SDK `36`
- Android package: `com.nerbuss.fhsmanager`
- Installed version: `1.0.26-uandroidexport-db8c706-20260426T213853Z`
- Installed versionCode: `2026042601`
- APK SHA256: `d1cfbb31d4d76672d10ceb8720d9662676f1e91d3db0b17c6a46079aaf530fa1`
- Final smoke screenshot: `C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\output\android-smoke-final-20260427.png`

## Gecen Kontroller

- `npm run build`: gecti.
- `npm --prefix src/functions run build`: gecti.
- `npx tsc -p tsconfig.node.json --noEmit`: gecti.
- `scripts/android-verify-apk-manifest.ps1`: gecti. APK, Unity artifact manifest ile eslesiyor.
- Android `:app:testDebugUnitTest`: gecti.
- Unity batchmode compile/import kontrolu: gecti. `C:\UnityProject\FHS\.tmp\unity-batch-compile-20260427.log` icinde C# compile/fatal hata bulunmadi.
- ADB launch smoke: uygulama acildi, `MainActivity` foreground oldu, process canli kaldi.
- ADB logcat launch smoke: 20 saniyelik yeni oturumda `FATAL EXCEPTION`, `ANR`, `CRASH` yakalanmadi.
- Android WebView CDP route smoke: ana modul sayfalari render oldu.
- Final ADB/CDP retest: cihazdaki WebView oturumu login ekranina dusmedi; ana menu, fikstur ve mac onizleme 5 saniyelik bekleme sonunda lig bitti durumunu dogru gosterdi.
- Rewarded Ads debug check: native plugin destekleniyor, SDK hazir, cached reklam var, aktif format `rewarded_interstitial`.
- `npm run live-league:env:check`: gecti. Canli lig deploy konfigleri tamam gorunuyor; `VITE_MATCH_CONTROL_BEARER` opsiyonel olarak eksik.
- `npm run sponsorship:sync:dry`: gecti. Sponsorluk katalog seed'i dry-run modunda dogrulandi.
- `firebase emulators:exec --only firestore,database,storage`: gecti. Firestore, Realtime Database ve Storage emulator/rules yukleme kontrolu basarili.

## Modul Smoke Sonuclari

Android WebView uzerinden canli oturumda acilan route'lar:

- `/`: render oldu. Ana sayfada `LIG BITTI / YENI MAC YOK` gorunuyor.
- `/academy`: render oldu, fakat permission uyarisi var.
- `/transfer-market`: render oldu, 78 oyuncu listesi gorundu.
- `/legend-pack`: render oldu, fakat 404 resource hatasi var.
- `/leagues`: render oldu.
- `/match-preview`: render oldu, lig bitti karti gorundu.
- `/fixtures`: render oldu.
- `/standings`: render oldu.
- `/team-planning`: render oldu.
- `/friends`: render oldu.
- `/champions-league`: render oldu, fakat eksik ceviri uyarisi var.
- `/training`: render oldu.
- `/finance`: render oldu.
- `/settings`: render oldu.
- `/team-assets`: render oldu.
- `/store/diamonds`: render oldu.
- `/store/vip`: render oldu.
- `/matches-history`: render oldu, fakat permission mesaji gorundu.
- `/friendly-match`: render oldu.
- `/match/M001`: render oldu, fakat fixture query uyarisi var.
- `/contact`: render oldu.

Final hedefli ADB retest:

- Ana sayfa `/`: `LIG BITTI / YENI MAC YOK` gorundu, Galatasaray/temp takim fallback'i gorulmedi.
- Fikstur `/fixtures`: 5 saniye bekleme sonunda `Lig bitti` ve sezon sonu sonuclari gorundu.
- Mac onizleme `/match-preview`: 5 saniye bekleme sonunda `Lig bitti` karti gorundu.
- MainActivity foreground: `com.nerbuss.fhsmanager/com.nerbuss.fhsmanager.MainActivity`.
- Bellek anlik durum: `TOTAL PSS 336275 KB`, `TOTAL RSS 467865 KB`, `Activities 1`, `WebViews 4`.

## Sorunlu Alanlar

### 1. Genel Vitest suite yesil degil

Komut: `npm run test`

Sonuc:
- 60 test dosyasi gecti.
- 4 test dosyasi fail.
- 246 test gecti.
- 3 test fail.

Hatalar:
- `src/services/youth.test.ts`: mock hoisting hatasi. `docMock` initialize edilmeden mock factory icinde kullaniliyor.
- `src/lib/positionLabels.test.ts`: test `RWB -> RB` bekliyor, ama assertion mesajinda `SGB` / `SGB` kisa etiket uyumsuzlugu gorunuyor. Position label beklentisi ile uygulama ciktisi uyumlu degil.
- `src/components/ui/player-status-card.test.tsx`: test `LanguageProvider` olmadan component render ediyor.
- `src/features/transfer/components/MarketList.test.tsx`: test `LanguageProvider` olmadan component render ediyor.

Etki:
- Test guveni dusuk. Transfer ve oyuncu kartlarindaki label davranisi manuelde calissa bile otomatik regresyon korumasi bozuk.

### 2. App TypeScript kontrolu fail

Komut: `npx tsc -p tsconfig.app.json --noEmit`

Ornek hatalar:
- `src/pages/ChatModerationAdmin.tsx`: `Loader2` import/isim hatasi.
- `src/features/team-planning/Pitch.tsx`: event target tipi `HTMLDivElement` ile uyumsuz.
- `src/pages/Training.tsx`: `Player.lastTrainedAt` type uzerinde yok.
- `src/services/championsLeague.ts`: Firestore data `unknown` tipleri dogrudan domain tipe atanmis.
- `src/types/*`: `CompetitionType` / `CompetitionFormat` export uyumsuzlugu.
- Bazi test dosyalarinda guncel type kontratiyla uyumsuz eski alanlar var.

Etki:
- Vite build geciyor, fakat typecheck gate olarak kullanilamaz durumda.

### 3. ESLint fail

Komut: `npm run lint`

Sonuc:
- 548 error.

En cok gorulen tipler:
- `@typescript-eslint/no-explicit-any`
- bos `catch`/block kullanimi
- optional chain sonrasinda non-null assertion

Etki:
- Lint CI gate olarak kullanilamaz durumda. Yeni hatalari eski borctan ayirmak zor.

### 4. Playwright E2E suite fail

Komut: `npm run test:e2e`

Sonuc:
- 3 testin 3'u fail.

Sebep:
- Testler `/fixtures`, `/standings`, `/match/M001` icin direkt sayfa header'i bekliyor.
- Gercek snapshot login ekranina dusuyor. Auth/seed olmadan route testleri korumali sayfalara ulasamiyor.

Etki:
- E2E testleri urun akislarini dogrulamiyor. Auth fixture veya test login kurulmadan bu suite sinyal vermiyor.

### 5. Android lint fail

Komut: `gradlew :app:lintDebug`

Sonuc:
- 3 error, 39 warning.

Hatalar:
- `android/app/src/main/res/values/styles.xml:20`: `android:windowLightNavigationBar` minSdk 25 icin API 27 gerektiriyor.
- `android/app/src/main/res/values/styles.xml:21`: `android:windowLayoutInDisplayCutoutMode` minSdk 25 icin API 27 gerektiriyor.
- `android/app/src/main/AndroidManifest.xml:73`: `com.unity3d.player.UnityPlayerActivity` intent-filter merge sonucu `android:exported` olmadan gorunuyor.

Ek not:
- Lint sirasinda `play-services-ads-25.1.0` icin Kotlin metadata uyumsuzlugu satirlari da basiliyor: binary metadata `2.2.0`, beklenen `2.0.0`.

Etki:
- APK assemble ve cihaz kurulumu calisiyor, fakat Android lint gate fail.

### 6. Canli WebView route smoke uyarilari

Android cihazdaki gercek WebView uzerinden route smoke sirasinda yakalanan runtime uyarilari:

- `/academy`: `FirebaseError: Missing or insufficient permissions.`
  - Kaynak: `[academy.listenPendingCandidates] Snapshot failed`
  - Ekranda da `Altyapi adaylarina erisim izni yok.` gorunuyor.

- `/matches-history`: `Missing or insufficient permissions.`
  - Ekranda gecmis maclar altinda permission mesaji gorunuyor.

- `/champions-league`: `[i18n] missing translation: tr:matchPreview.kickoff`
  - Eksik TR ceviri anahtari.

- `/legend-pack`: `Failed to load resource: the server responded with a status of 404`
  - Nostalji sayfasinda bir asset/resource 404 donuyor. Hangi asset oldugu icin browser network trace gerekir.

- `/match/M001`: `Invalid query. When querying a collection group by documentId(), the value provided must result in a valid document path, but 'M001' is not because it has an odd number of segments (1).`
  - MatchWatcher test route'u tek segment fixture id ile collectionGroup documentId query yapiyor.

- `/settings`: Firestore `Commit` isteginde `failed-precondition` uyarisi goruldu.
  - Ayarlar sayfasi render oluyor, fakat arka planda maas/current verify veya benzeri bir Firestore precondition guncel veri ile uyusmuyor olabilir.

- `/contact`: `[MatchWatcher] getMatchTimeline failed FirebaseError: AppCheck required`
  - Bu uyarinin contact route'a tasinmasi onceki `/match/M001` listener'inin kapanmamasi veya arka planda kalmasi ile iliskili gorunuyor.

Etki:
- Sayfalar render oluyor, fakat bu uyarilar gercek kullanici deneyiminde hata mesaji veya eksik veri olarak gorunebilir.

### 7. Production dependency audit fail

Komut: `npm audit --omit=dev --json`

Sonuc:
- Toplam 34 vulnerability.
- 2 critical.
- 15 high.
- 13 moderate.
- 4 low.

One cikan paketler:
- `protobufjs`: critical.
- `fast-xml-parser`: critical/high/moderate zinciri.
- `@capacitor/cli` -> `tar`: high.
- `react-router-dom` / `react-router` / `@remix-run/router`: high/moderate redirect/XSS advisory.
- `firebase-admin` / `firebase-functions` zinciri: moderate; audit fix onerisi major/downgrade etkili oldugu icin dikkatli ele alinmali.
- `express`, `path-to-regexp`, `qs`, `lodash`, `node-forge`, `postcss` gibi transit/direct paketlerde advisory var.

Etki:
- Bu bulgu direkt runtime exploit anlamina gelmez; paketlerin hangi ortamda kullanildigi ve input yuzeyi ayrica incelenmeli. Yine de release oncesi dependency upgrade planina alinmali.

## Reklam Test Durumu

- Native rewarded ads plugin launch loglarinda uygulama acilisinde crash gorulmedi.
- WebView devtools listesinde Google Ads WebView context'leri gorundu.
- Final ADB debug check sonucu:
  - `sdkReady`: true
  - `mobileAdsInitialized`: true
  - `adLoaded`: true
  - `adFormat`: `rewarded_interstitial`
  - `consentStatus`: `UNKNOWN`
  - `isTestDevice`: true
  - `admobUseTestIds`: false
- Onceki temiz launch loglarinda UMP/AdMob tarafinda risk goruldu:
  - consent update `Publisher misconfiguration` ile basarisiz oldu.
  - standart rewarded load format mismatch sonrasi rewarded interstitial retry yapildi.
  - bir denemede AdMob `Ad failed to load : 3` dondu.
- Reklam odulu verme akisi otomatik tiklanmadi. Bunun nedeni testin gercek kullanici hesabi uzerinde veri/odul degisikligi yapacak olmasi.

Etki:
- Bu cihazda reklam cache'i su anda dolu gorunuyor; ancak consent `UNKNOWN`, UMP config uyarisi ve `no fill` kodu bazi cihazlarda "reklam izleyemiyor" sikayetini aciklayabilir.
- AdMob konsolunda app id, UMP form/publisher configuration ve kullanilan ad unit formatinin rewarded interstitial ile uyumu kontrol edilmeli.

## Transfer Test Durumu

- Otomatik testte transfer satin alma tiklanmadi.
- WebView smoke'ta `/transfer-market` render oldu ve pazar listesi gorundu.
- Kullanici manuel olarak transfer satin alma denedi ve oyuncunun takima girdigini dogruladi.

## Lig Bitti / Temp Takim Test Durumu

- Ana sayfa: `LIG BITTI` ve `YENI MAC YOK` gorundu.
- Mac onizleme: `Lig bitti` karti gorundu.
- Fikstur: sezon programi ve lig bitis bilgisi render oldu.
- Ilk acilista Galatasaray fallback'i WebView smoke'ta gorulmedi.

Final ADB tekrarinda da ayni sonuc alindi:
- `/`: `LIG BITTI / YENI MAC YOK`
- `/fixtures`: `Lig bitti` ve sezon sonu mac listesi
- `/match-preview`: `Lig bitti` ve `Fiksture Git`

## Onceliklendirilmis Aksiyonlar

1. Android lint hatalarini duzelt.
   - `values-v27/styles.xml` ayrimi yap.
   - Merged `UnityPlayerActivity` icin `android:exported` durumunu netlestir.

2. Runtime permission uyarilarini temizle.
   - Academy pending candidates read rule veya query yetkisi.
   - Matches history read rule veya query yetkisi.

3. Rewarded ads/AdMob config riskini netlestir.
   - UMP consent/publisher config uyarisi.
   - Ad unit formatinin `rewarded_interstitial` beklentisiyle uyumu.
   - `Ad failed to load : 3` icin kullaniciya net "reklam bulunamadi, sonra tekrar dene" fallback'i.

4. MatchWatcher `documentId()` query'sini duzelt.
   - Tek segment `M001` ile collectionGroup documentId query yapilamaz; full document path veya farkli field query kullanilmali.

5. Ayarlar sayfasindaki Firestore `failed-precondition` uyarisini incele.
   - Ekran render oluyor ama arka plandaki verify/commit akisi stale data ile calisiyor olabilir.

6. Test altyapisini toparla.
   - Vitest component testlerine `LanguageProvider` wrapper ekle.
   - `youth.test.ts` mock hoisting hatasini duzelt.
   - Position label test beklentisini urun kararina gore guncelle.

7. E2E testlerini auth/seed destekli hale getir.
   - Login fixture veya test user local/session setup olmadan korumali route testleri anlamli sonuc vermiyor.

8. TypeScript ve ESLint borcunu baseline veya kademeli gate ile yonet.
   - Su an iki gate de tum repo icin bloklayici.

## Sonuc

Uygulama build aliyor, Android cihazda aciliyor, ana modul sayfalari render oluyor ve son duzeltilen lig bitti/transfer alanlarinda gorunur bir sorun yok. Ancak otomatik test altyapisi ve kalite gate'leri yesil degil. En somut urun riski permission hatalari, MatchWatcher query hatasi, eksik ceviri ve Android lint hatalari.
