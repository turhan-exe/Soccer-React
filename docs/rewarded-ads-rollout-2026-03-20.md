# Android Rewarded Ads Rollout

## Current State

- Android rewarded ads code is integrated.
- Backend SSV flow is live.
- Firestore rules are deployed.
- Current Android config uses AdMob test IDs.

Current config file:

`android/admob.properties`

Current values:

```properties
ADMOB_APP_ID_ANDROID=ca-app-pub-3940256099942544~3347511713
ADMOB_REWARDED_UNIT_ID_ANDROID=ca-app-pub-3940256099942544/5224354917
ADMOB_USE_TEST_IDS=true
```

## Live Reward Placements

- `kit_reward`
  - Main menu kit reward
  - Top bar kit reward
- `training_finish`
  - Training page "Reklam Izle (Hemen Bitir)"
- `player_rename`
  - Team Planning player rename with ad

## Backend Endpoints

- Callable: `createRewardedAdSession`
- Callable: `claimRewardedAdReward`
- HTTPS SSV callback: `https://europe-west1-osm-react.cloudfunctions.net/admobRewardedSsv`

## AdMob Setup

### 1. Add the app

1. Open `https://admob.google.com`
2. Left menu: `Apps`
3. Click `Add app`
4. Choose `Android`
5. Choose `Yes, it's listed on a supported app store`
6. Click `Continue`
7. Search for `FHS` or `com.nerbuss.fhsmanager`
8. Click `Add`
9. Keep `User metrics` enabled
10. Click `Add app`

### 2. Copy the AdMob App ID

1. Open the `FHS` app in AdMob
2. Go to `App settings`
3. Copy the `App ID`

### 3. Create the rewarded unit

1. Open `FHS`
2. Go to `Ad units`
3. Click `Add ad unit`
4. Choose `Rewarded`
5. Set ad unit name to `android_rewarded_shared`
6. Reward item: `reward`
7. Reward amount: `1`
8. Click `Create ad unit`
9. Copy the created `Ad unit ID`

### 4. Enable server-side verification

1. Open the new rewarded ad unit
2. Find `Server-side verification`
3. Click `Enable`
4. Callback URL:

```text
https://europe-west1-osm-react.cloudfunctions.net/admobRewardedSsv
```

5. Save

### 5. Publish privacy messages

1. Left menu: `Privacy & messaging`
2. Open `European regulations`
3. Click `Create message`
4. Select `FHS`
5. Finish the flow
6. Click `Publish`
7. If available, repeat for `US states regulations`

## Switch From Test IDs To Real IDs

Open:

`android/admob.properties`

Replace with your real IDs:

```properties
ADMOB_APP_ID_ANDROID=YOUR_REAL_ADMOB_APP_ID
ADMOB_REWARDED_UNIT_ID_ANDROID=YOUR_REAL_REWARDED_UNIT_ID
ADMOB_USE_TEST_IDS=false
```

Then rebuild:

```powershell
cd C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui
npm run build
npx cap sync android
cd android
.\gradlew.bat :app:bundleRelease
```

## Internal Testing

1. Open Play Console
2. Open `FHS`
3. Left menu: `Test edin ve yayinlayin`
4. Open `Test etme`
5. Open `Internal testing`
6. Click `Yeni surum olustur`
7. Upload:

`android/app/build/outputs/bundle/release/app-release.aab`

8. Click `Kaydet`
9. Click `Incelemeye gonder` or `Start rollout to internal testing`
10. Open `Test kullanicilari`
11. Add tester email addresses
12. Open the opt-in link on the Android device
13. Install the Play version from the Play Store

## What To Test On Device

### Kit reward

1. Open main menu or top bar
2. Open kit reward
3. Watch ad
4. Confirm kit is added

### Training finish

1. Start a training session
2. Tap `Reklam Izle (Hemen Bitir)`
3. Finish the ad
4. Confirm the training completes

### Player rename

1. Open `Team Planning`
2. Open player rename dialog
3. Choose the ad option
4. Finish the ad
5. Confirm the player name updates

### Privacy options

1. Open `Settings`
2. Open `Veri Yonetimi`
3. Tap `Reklam gizlilik tercihleri`
4. Confirm the privacy form opens when available

## Notes

- The repo currently ships with AdMob test IDs to avoid invalid traffic during integration.
- Real monetization starts only after real IDs are placed in `android/admob.properties` and a new release build is uploaded.
- The youth ad code path was intentionally left out of this rollout.
