# football-manager-ui

React + Capacitor mobil host uygulamasi. Bu repo:

- React/Vite arayuzunu
- Android native host katmanini
- Android Unity as a Library entegrasyonunu
- match-control-api ve node-agent servislerini
- Firebase Functions tarafini

icerir.

Unity simulasyon kaynak kodu bu repoda degil. O kodlar ayri repodadir:

- `C:\UnityProject\FHS`
- GitHub: `turhan-exe/FHS`

## Bu Iki Repo Birlikte Ne Yapiyor

- `football-manager-ui`:
  - uygulamanin menu, giris, dostluk, lig, replay ve mobil host tarafidir
  - App Store / TestFlight'a yuklenecek iOS shell buradan cikar
- `FHS`:
  - Unity simulasyon, mac motoru, taktik ekrani, render ve match scene kaynaklaridir
  - iOS'ta simulasyon kullanilacaksa Unity export bu repodan alinir

## Mevcut iOS Durumu

Bu nokta kritik:

- iOS Capacitor host projesi bu repoda var: [`ios/App`](./ios/App)
- Android icin Unity native entegrasyonu tamam ve repoda mevcut
- iOS icin native Unity embed akisi Android kadar otomatik degil

Bu ne demek:

- Biri bu repoyu klonlayip iOS shell uygulamasini Xcode ile build edebilir
- Ama iOS'ta native Unity simulasyon da calissin isteniyorsa, `FHS` reposundan iOS Unity export alinip iOS host icine ek entegrasyon yapilmasi gerekir

Kisa karar:

- Sadece React/Capacitor shell'i build etmek istiyorsan: bu repo yeterli
- iOS'ta Unity simulasyon da calissin istiyorsan: bu repo + `FHS` repo birlikte gerekir

## Gereksinimler

Bu repo ile iOS build almak icin:

- macOS
- Xcode
- Apple Developer hesabı
- CocoaPods
- Node.js 20+
- pnpm 8+

Unity simulasyonunu iOS'a da tasimak istenirse ek olarak:

- Unity Hub
- Unity `6000.3.11f1`
- Unity iOS Build Support modulu

## iOS Build Adimlari

Bu adimlari hicbir sey bilmiyormus gibi uygula.

### 1. Iki repoyu klonla

Bu repo:

```bash
git clone https://github.com/turhan-exe/Soccer-React.git
```

Unity repo:

```bash
git clone https://github.com/turhan-exe/FHS.git
```

### 2. Frontend env dosyasini olustur

Bu repoda:

```bash
cp .env.example .env.local
```

Sonra `.env.local` icini doldur.

Hangi alanlar doldurulacak:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_FUNCTIONS_REGION`
- `VITE_FUNCTIONS_BASE_URL`
- `VITE_MATCH_CONTROL_BASE_URL`

Opsiyonel ama kullanilan alanlar:

- `VITE_MATCH_CONTROL_BEARER`
- `VITE_ACTIVE_SEASON_ID`
- `VITE_USERS_API_ENDPOINT`
- `VITE_CHAT_API_ENDPOINT`
- `VITE_CHAT_SANCTION_ENDPOINT`
- `VITE_CHAT_SANCTION_SECRET`
- `VITE_UNITY_REPLAY_IFRAME`
- `VITE_AUTH_USE_REDIRECT`
- `VITE_DISABLE_APPCHECK`
- `VITE_ENABLE_APPCHECK_DEV`
- `VITE_APPCHECK_SITE_KEY`
- `VITE_APPCHECK_DEBUG_TOKEN`
- `VITE_USE_FUNCTIONS_EMULATOR`
- `VITE_USE_HTTP_FUNCTIONS`

### 3. iOS Firebase dosyasini elle ekle

GitHub'a yuklenmeyen ama iOS build icin gereken dosya:

- `ios/App/App/GoogleService-Info.plist`

Bu dosya Firebase console'dan, iOS uygulamasi icin indirilmeli.

Not:

- Bu dosya repo icinde yok
- Xcode build almadan once bu dosya fiziksel olarak bu klasore konmali
- Bundle identifier degisirse yeni `GoogleService-Info.plist` gerekir

### 4. Paketleri kur

```bash
pnpm install
```

### 5. Web build al

```bash
pnpm run build
```

### 6. Capacitor iOS dosyalarini guncelle

```bash
npx cap sync ios
```

### 7. Xcode projesini ac

```bash
open ios/App/App.xcworkspace
```

Eger `App.xcworkspace` yoksa:

```bash
cd ios/App
pod install
open App.xcworkspace
```

### 8. Xcode signing ayarlarini yap

Xcode icinde:

- target: `App`
- Signing & Capabilities
- kendi Apple Team'ini sec
- gerekiyorsa bundle id'yi guncelle

Mevcut bundle id:

- `com.nerbuss.fhsmanager`

Eger bunu degistirirsen:

- Firebase'de ayni bundle id ile yeni iOS app ac
- yeni `GoogleService-Info.plist` indir

### 9. Cihaza kur veya archive al

Test icin:

- bir iPhone bagla
- Xcode'da cihazı sec
- Run

App Store / TestFlight icin:

- Product -> Archive
- Organizer -> Distribute App

## iOS'ta Unity Simulasyon Gerekecekse

Sadece bu repo yeterli degil.

Ek olarak `FHS` reposundan iOS export alinmali. Ayrintili adimlar icin:

- `FHS/README.md`

Bugunku gercek durum:

- Android Unity entegrasyonu bu repoda hazir
- iOS Unity native entegrasyonu icin ek calisma gerekir

Bu nedenle iOS build alacak kisiye bunu net soyle:

- React/Capacitor shell build edilebilir
- Ama tam native Unity simulasyon iOS'ta isteniyorsa `FHS` export + iOS native integration gerekir

## GitHub'a Yuklenmeyen Ama Doldurulmasi Gereken Dosyalar

Bu listeyi iOS build alacak kisiye gonderebilirsin.

### Bu repoda zorunlu veya yari-zorunlu dosyalar

- `.env.local`
  - frontend Vite degiskenleri
- `ios/App/App/GoogleService-Info.plist`
  - Firebase iOS config

### Backend'i de o kisi kuracaksa gerekli dosyalar

- `services/match-control-api/.env`
- `services/node-agent/.env`
- `src/functions/.env`
- `src/functions/.env.prod`
- `src/functions/.env.staging`

Bu backend dosyalari iOS derlemek icin degil, dostluk maclari / lig / dedicated server / join ticket akisi icin gereklidir.

## Backend Env Ozet Listesi

### `services/match-control-api/.env`

En kritik alanlar:

- `MATCH_CONTROL_SECRET`
- `MATCH_CONTROL_CALLBACK_TOKEN`
- `SESSION_SIGNING_KEY`
- `MATCH_CONTROL_CALLBACK_BASE_URL`
- `FIREBASE_LIFECYCLE_URL`
- `FIREBASE_LIFECYCLE_TOKEN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `POSTGRES_URL`
- `REDIS_URL`
- `NODE_AGENTS` veya `NODE_AGENTS_FRIENDLY` / `NODE_AGENTS_LEAGUE`

### `services/node-agent/.env`

En kritik alanlar:

- `NODE_ID`
- `NODE_PUBLIC_IP`
- `NODE_PRIVATE_IP`
- `NODE_AGENT_SECRET`
- `UNITY_SERVER_BINARY`
- `UNITY_SERVER_WORKDIR`
- `ALLOCATABLE_PORTS`
- `MATCH_CONTROL_CALLBACK_BASE_URL`
- `MATCH_CONTROL_CALLBACK_TOKEN`
- `UNITY_MATCH_ROLE`

### `src/functions/.env*`

En kritik alanlar:

- `MATCH_CONTROL_BASE_URL`
- `MATCH_CONTROL_SECRET`
- `LEAGUE_LIFECYCLE_SECRET`
- `BATCH_SECRET`
- `LEAGUE_KICKOFF_HOURS_TR`
- `LEAGUE_PREWARM_LEAD_MINUTES`
- `LEAGUE_PREPARE_WINDOW_MINUTES`
- `LEAGUE_KICKOFF_WINDOW_MINUTES`
- `LEAGUE_RUNNING_TIMEOUT_MINUTES`

## Android / Unity Notu

Android export yardimci scriptleri:

- [`scripts/run-unity-android-export.cmd`](./scripts/run-unity-android-export.cmd)
- [`scripts/sync-unity-export.ps1`](./scripts/sync-unity-export.ps1)

Bu scriptler iOS icin degil, Android Unity export/senkronu icindir.

## Kisa Handover Mesaji

iOS build alacak kisiye su kisa bilgi gonderilebilir:

1. `Soccer-React` ve `FHS` repolarini klonla.
2. `Soccer-React/.env.example` dosyasini `.env.local` olarak kopyala ve sahibi tarafindan verilen degerleri doldur.
3. `ios/App/App/GoogleService-Info.plist` dosyasini Firebase'den alip yerine koy.
4. `pnpm install`, `pnpm run build`, `npx cap sync ios`, sonra `ios/App/App.xcworkspace` ac.
5. Apple Team / Signing ayarlarini yapip cihaza kur veya archive al.
6. Eger iOS'ta Unity simulasyon da isteniyorsa `FHS` reposundaki iOS export adimlarini da uygula; bu kisim Android kadar otomatik degil.
