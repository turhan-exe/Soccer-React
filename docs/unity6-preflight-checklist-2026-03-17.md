# Unity 6 Oncesi Checklist

Bu dokuman, `football-manager-ui` repo'su icin Unity 6 gecisi oncesi geri donus noktasi olusturmak icin hazirlandi.

## Mevcut Durum

- Repo yolu: `C:\Users\TURHAN\Desktop\MGX\workspace\football-manager-ui`
- Mevcut branch: `backup/2026-03-14-pre-fps-source`
- Remote: `origin = https://github.com/turhan-exe/Soccer-React.git`
- Working tree su an dirty. Unity 6 oncesi snapshot, mevcut local degisiklikleri de kapsayacak.

## GitHub Backup Adimlari

1. Son durumu gozden gecir:
   - `git status --short`
2. Unity 6 oncesi yeni backup branch'i ac:
   - `git switch -c backup/unity6-preflight-2026-03-17`
3. Tum degisiklikleri commit et:
   - `git add -A`
   - `git commit -m "backup: unity6 oncesi snapshot"`
4. Branch'i GitHub'a push et:
   - `git push -u origin backup/unity6-preflight-2026-03-17`
5. Ayni nokta icin tag ac:
   - `git tag unity6-preflight-2026-03-17`
   - `git push origin unity6-preflight-2026-03-17`

## Unity 6 Oncesi Teknik Kontrol

Unity 6 migration oncesi asagidaki alanlar not alinmali:

- `android/unityLibrary/build.gradle`
- `android/app/build.gradle`
- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/java/com/nerbuss/fhsmanager/unity/UnityMatchPlugin.java`
- `android/unityLibrary/src/main/java/com/unity3d/player/EmbeddedUnityPlayerActivity.java`
- `android/unityLibrary/src/main/java/com/unity3d/player/UnityPlayerActivity.java`
- `capacitor.config.ts`

## Unity 6 Sonrasi Ilk Karsilastirma

- `android/unityLibrary` export yapisi degisti mi
- Unity activity lifecycle override'lari ezildi mi
- manifest merge sonucu `UnityHostActivity` veya `EmbeddedUnityPlayerActivity` bozuldu mu
- `x86_64` emulator destegi export'a tekrar geldi mi
- `assembleDebug` temiz geciyor mu
- Unity acilis/kapanis akisi React shell'i kapatmadan calisiyor mu

## Rollback

Unity 6 gecisi sorun cikarirsa:

1. Bu branch/tag'e don:
   - `git fetch origin --tags`
   - `git switch backup/unity6-preflight-2026-03-17`
2. Gerekirse tag'den ayri bir fix branch ac:
   - `git switch -c rollback/unity6-preflight unity6-preflight-2026-03-17`

