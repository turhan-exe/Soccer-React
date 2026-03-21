# Social Auth Firebase Fix - 2026-03-20

This app uses package name `com.nerbuss.fhsmanager`.

## Root cause

Google Sign-In on Android is currently configured only for the debug certificate.

Current `google-services.json` contains this Android SHA-1:

- Debug SHA-1: `F5:FD:63:CA:33:77:F0:D6:9E:0D:FA:D4:AB:0A:4C:29:2B:2C:DC:A3`

Current release/upload keystore fingerprints are:

- Release SHA-1: `69:32:C3:17:D6:5B:6E:A1:96:84:3D:58:AB:66:47:D8:52:EB:F3:93`
- Release SHA-256: `6F:E4:AA:91:31:60:00:72:98:EF:4A:42:67:7F:85:B0:0E:91:6D:C5:1C:43:B3:26:35:ED:14:9D:AF:15:E8:F1`

Current debug keystore fingerprints are:

- Debug SHA-1: `F5:FD:63:CA:33:77:F0:D6:9E:0D:FA:D4:AB:0A:4C:29:2B:2C:DC:A3`
- Debug SHA-256: `73:AC:FD:E6:B1:00:BF:5A:C6:42:7C:B8:F8:CC:3F:7C:4A:6F:0B:E9:3D:8B:A9:EA:42:A6:2E:F9:AC:8B:DE:E6`

## Required Firebase Console changes

### Google Sign-In

1. Open Firebase Console.
2. Go to `Project settings`.
3. In `Your apps`, open Android app `com.nerbuss.fhsmanager`.
4. Add these fingerprints:
   - release SHA-1
   - release SHA-256
   - debug SHA-1
   - debug SHA-256
5. If the app is downloaded from Google Play, also open Play Console:
   - `App integrity`
   - copy the `App signing key certificate` SHA-1 and SHA-256
   - add both of those to the same Firebase Android app
6. In Firebase Console, open `Authentication > Sign-in method`.
7. Make sure `Google` provider is enabled.
8. Make sure a project support email is set.
9. Download the new `google-services.json`.
10. Replace `android/app/google-services.json` with the downloaded file.

Important:

- If you test a locally signed build, Firebase must know the local release keystore fingerprints.
- If you test a Play-installed build, Firebase must know the Play App Signing fingerprints as well.

### Apple Sign-In

1. Open `Firebase Console > Authentication > Sign-in method`.
2. Enable `Apple`.
3. Fill in:
   - Apple Service ID
   - Apple Team ID
   - Apple Key ID
   - Apple private key (`.p8`)
4. In Apple Developer console, configure the Service ID return URL as:
   - `https://osm-react.firebaseapp.com/__/auth/handler`
5. In Firebase `Authentication > Settings > Authorized domains`, make sure this exists:
   - `osm-react.firebaseapp.com`
6. If you use a custom auth domain later, add that domain to Firebase authorized domains and Apple return URLs too.

## Repo-side changes already applied

- `capacitor.config.ts` now sets `FirebaseAuthentication.authDomain = "osm-react.firebaseapp.com"`.
- Native auth error messages in the app should now point to the exact missing Firebase/Apple setup area.

## After downloading the new google-services.json

Run:

```powershell
cd C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui
npx cap sync android
cd android
.\gradlew.bat :app:assembleDebug
```

For release testing:

```powershell
cd C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui\android
.\gradlew.bat :app:bundleRelease
```
