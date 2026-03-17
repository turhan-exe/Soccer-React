# Git History Cleanup Commands

Bu repo için working tree ve index temizliği yapıldı, fakat `.git` hâlâ yaklaşık `1.78 GiB` pack geçmişi taşıyor.

Bu adımlar geçmiş commit'lerdeki büyük blob'ları da temizlemek içindir.

## 1. Ön hazırlık

Temizliği mevcut branch üzerinde force-push ile yapacağın için önce yedek al:

```powershell
git branch backup/pre-history-cleanup
git tag backup-pre-history-cleanup
```

Mümkünse bunu temiz bir clone üzerinde yap.

## 2. `git-filter-repo` kur

Bu makinede `git filter-repo` kurulu değil.

Windows için pratik kurulum:

```powershell
py -m pip install git-filter-repo
```

Kurulumdan sonra doğrula:

```powershell
git filter-repo --version
```

## 3. Önce mevcut cleanup değişikliklerini commit et

```powershell
git add -A
git commit -m "chore: remove generated artifacts and large tracked outputs"
```

## 4. Geçmişten büyük artifact alanlarını temizle

```powershell
git filter-repo --force --invert-paths `
  --path-glob ".tmp/**" `
  --path-glob "tmp-build/**" `
  --path-glob "dist/**" `
  --path-glob "node_modules/**" `
  --path-glob "src/functions/node_modules/**" `
  --path-glob "services/match-control-api/node_modules/**" `
  --path-glob "services/node-agent/node_modules/**" `
  --path-glob "android/app/build/**" `
  --path-glob "android/unityLibrary/build/**" `
  --path-glob "android/unityLibrary/symbols/**" `
  --path-glob "android/_unity_patch_backup/**" `
  --path-glob "android/.gradle/**" `
  --path-glob "android/build/**" `
  --path-glob "android/.idea/**" `
  --path-glob "ios/App/App/public/**" `
  --path-glob "ios/App/Pods/**" `
  --path-glob "ios/App/build/**" `
  --path-glob "ios/DerivedData/**" `
  --path-glob "public/Unity/**" `
  --path-glob "Unity/Headless/Build/**" `
  --path-glob "Unity/Render/Build/**" `
  --path-glob "Unity/LinuxBuild/**" `
  --path-glob "android/unityLibrary/src/main/Il2CppOutputProject/**" `
  --path-glob "android/unityLibrary/src/main/jniLibs/**" `
  --path-glob "android/unityLibrary/src/main/jniStaticLibs/**" `
  --path-glob "android/unityLibrary/src/main/assets/aa/**" `
  --path-glob "android/unityLibrary/src/main/assets/bin/**" `
  --path "firebase-debug.log" `
  --path "render-test.mp4" `
  --path-glob "friendly_*.txt" `
  --path-glob "unity_*.txt" `
  --path-glob "logcat_*.txt" `
  --path-glob "tmp-*.log" `
  --path-glob ".tmp-*.log" `
  --path-glob "docs/benchmark-reports/*.txt"
```

## 5. Eski ref ve garbage temizliği

```powershell
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git count-objects -vH
```

## 6. Remote'a force-push

Eğer bu repo daha önce remote'a pushlandıysa history rewrite sonrası force-push gerekir:

```powershell
git push --force --all origin
git push --force --tags origin
```

## 7. Kontrol

Temizlikten sonra artık `git ls-files` içinde şu alanlar görünmemeli:

- `.tmp/`
- `tmp-build/`
- `dist/`
- `public/Unity/`
- `Unity/Headless/Build/`
- `Unity/Render/Build/`
- `Unity/LinuxBuild/`
- `android/unityLibrary/build/`
- `android/unityLibrary/symbols/`
- `android/unityLibrary/src/main/Il2CppOutputProject/`
- `android/unityLibrary/src/main/jniLibs/`
- `android/unityLibrary/src/main/assets/bin/`

Hızlı kontrol:

```powershell
git ls-files | rg "^(\\.tmp/|tmp-build/|dist/|public/Unity/|Unity/Headless/Build/|Unity/Render/Build/|Unity/LinuxBuild/|android/unityLibrary/build/|android/unityLibrary/symbols/|android/unityLibrary/src/main/Il2CppOutputProject/|android/unityLibrary/src/main/jniLibs/|android/unityLibrary/src/main/assets/bin/)"
```

Hiç çıktı vermemeli.
