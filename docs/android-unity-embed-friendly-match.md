# Android Embedded Unity Friendly Match (Capacitor + FHS) Setup

This document covers the manual steps that cannot be fully automated from this repository.

## What is implemented in code (this repo + FHS)

- `football-manager-ui` now calls a real Capacitor Android plugin (`UnityMatch`) instead of always showing a mock alert.
- Android plugin launches `UnityHostActivity`, which then attempts to start a Unity activity in the same app.
- Unity launch payload (`serverIp`, `serverPort`, `matchId`, `joinTicket`, `mode`, `role`) is passed as Android intent extras.
- FHS runtime now reads Android extras via `MobileLaunchOptions` and auto-connects `MatchNetworkManager` using IP/port + ticket/matchId.
- Friendly accept/join calls now request spectator role (API signs ticket with spectator for requester, and accept path supports role payload).

## What is still manual (required)

1. Export Unity Android client as **Unity as Library**
2. Import `unityLibrary` into `football-manager-ui/android`
3. Build and run Android app on device
4. Configure Hetzner public API and match node match ports

---

## 1) FHS Unity Android Export (Unity as Library)

Open `C:\UnityProject\FHS` in Unity.

1. `File > Build Settings`
2. Platform: `Android` (switch if needed)
3. `Player Settings`:
   - Scripting backend: `IL2CPP`
   - Target Architectures: `ARM64` (and ARMv7 if you want wider support)
   - Internet permission: `Require`
4. `Project Settings > Player > Resolution and Presentation`
   - Orientation compatible with your app flow (landscape recommended for match view)
5. `File > Build Settings`:
   - Enable **Export Project**
   - Enable **Build as a Library** (Unity version wording may vary)
6. Export to a temporary folder, e.g.:
   - `C:\UnityProject\FHS\Builds\AndroidUnityLibraryExport`

Result should include:
- `unityLibrary/`
- `launcher/` (not needed for final integration)

---

## 2) Import Unity Library into Capacitor Android Project

Target project:
- `C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\android`

### Copy/merge

1. Copy `unityLibrary/` from Unity export into:
   - `football-manager-ui/android/unityLibrary`
2. Do **not** use Unity export `launcher` module.

### `android/settings.gradle`

Add:
- `include ':unityLibrary'`
- `project(':unityLibrary').projectDir = new File('unityLibrary')`

### `android/app/build.gradle`

Add dependency:
- `implementation project(':unityLibrary')`

Potential fixes (depends on Unity export version):
- packagingOptions conflicts
- duplicate libs
- manifest placeholders
- minSdk/targetSdk alignment

### AndroidManifest merge

If Unity export provides its own activity, the current plugin defaults to:
- `com.unity3d.player.UnityPlayerActivity`

If your Unity export uses a different class, update metadata in:
- `android/app/src/main/AndroidManifest.xml`

Key:
- `com.nerbuss.fhsmanager.UNITY_ACTIVITY_CLASS`

---

## 3) Build and Run Android App

From project root (`football-manager-ui`):

1. Build web assets
   - `npm run build`
2. Sync Capacitor
   - `npx cap sync android`
3. Open Android Studio
   - `npx cap open android`
4. Run on real Android device (USB debug enabled)

Important:
- Emulator may fail or perform poorly with Unity + real networking.
- Prefer real device for the first test.

---

## 4) Hetzner Runtime Requirements (Real Mobile Test)

For mobile users outside your PC:

- `VITE_MATCH_CONTROL_BASE_URL` must be a public HTTPS URL
- `match-control-api` must be reachable on `443`
- `node-agent` stays private/internal
- Match node TCP port pool must be publicly reachable (e.g. `21001-21003`)
- `NODE_PUBLIC_IP` on each node must be the actual public IP

### Firewall checklist

- API node:
  - TCP 443 open
- Match nodes:
  - TCP 21001-21003 (or your allocated range) open
- Node agent:
  - internal/private only

---

## 5) Testing Flow (Mobile)

1. User A sends friendly request
2. User B accepts
3. App should call native plugin and open Unity in-app
4. User A taps `Match'e Katil`
5. App should open Unity in-app with join ticket

If Unity does not open:
- Check Android logcat for `UnityMatchPlugin` / `UnityHostActivity`
- Most common cause: `unityLibrary` not imported or wrong Unity activity class

---

## 6) Current Limitations (Expected)

- Unity plugin emits lifecycle events (`ready`, `connected`, `closed`, `error`) from Android host/trampoline.
- It does **not** yet emit true in-match events (`match_ended`, real connection telemetry) from Unity runtime.
- Browser still uses mock fallback (by design).
- Spectator role is the first target; gameplay control/match intervention is future work.
