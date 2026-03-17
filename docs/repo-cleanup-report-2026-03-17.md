# Repo Temizlik Raporu

Tarih: 2026-03-17

## 1. En çok alan kaplayan üst klasörler

Yaklaşık ölçümler:

- `android`: 19.46 GB
- `.tmp`: 2.99 GB
- `.git`: 2.98 GB
- `Unity`: 2.67 GB
- `tmp-build`: 774 MB
- `node_modules`: 598 MB
- `ios`: 356 MB
- `dist`: 356 MB
- `public`: 347 MB
- `src`: 126 MB
- `services`: 72 MB
- `docs`: 66 MB

Asıl şişkinlik kaynak koddan değil, Unity export/build çıktılarından, Android derleme çıktılarından, geçici klasörlerden ve log dosyalarından geliyor.

## 2. Kod ve mimari açısından aktif olan yapılar

Bu repo yalnızca React/Vite UI değil. Unity ve mobil entegrasyonu aktif kullanılıyor:

- `package.json` içindeki `predev` scripti `scripts/copy-unity.mjs` çalıştırıyor.
- `scripts/copy-unity.mjs` kaynağı `Unity/match-viewer` klasöründen `public/Unity/match-viewer` içine kopya alıyor.
- `capacitor.config.ts` içinde `webDir: 'dist'` tanımlı; yani mobil paketler web build çıktısından besleniyor.
- `android/settings.gradle` içinde `:unityLibrary` modülü ekli.
- `android/app/build.gradle` içinde `implementation project(':unityLibrary')` var.
- `android/unityLibrary/build.gradle` Unity Android Library modülünün gerçekten build edildiğini gösteriyor.

Sonuç:

- `android/unityLibrary` klasörünü komple silmek doğru değil.
- `Unity` klasörünü komple silmek doğru değil.
- Ama bu iki yapının içinde ciddi miktarda build/export/artifact çöpü var.

## 3. En büyük alt alanlar ve yorumu

### `android`

- `android/unityLibrary`: 10.74 GB
- `android/app`: 7.85 GB
- `android/_unity_patch_backup`: 676 MB

Alt kırılım:

- `android/app/build`: 7.49 GB
- `android/unityLibrary/build`: 8.49 GB
- `android/unityLibrary/symbols`: 1.29 GB
- `android/unityLibrary/src`: 959 MB
- `android/app/src`: 359 MB

Yorum:

- `android/app/build` kesinlikle silinebilir.
- `android/unityLibrary/build` kesinlikle silinebilir.
- `android/unityLibrary/symbols` kesinlikle silinebilir veya Git dışı tutulmalı.
- `android/_unity_patch_backup` kesinlikle silinebilir.
- `android/app/src/main/assets/public` generated web asset kopyasıdır; `android/.gitignore` zaten bunu ignore ediyor.
- `android/unityLibrary/src/main` klasörünün tamamı gereksiz değil; ama içindeki `Il2CppOutputProject` büyük ölçüde generated export içeriği.

### `.tmp`

En büyük parçalar:

- `.tmp/AndroidUnityLibraryExport`: 803 MB
- `.tmp/AndroidUnityLibraryExport_clean2`: 803 MB
- `.tmp/linux-runtime-20260317-0016.tar.gz`: 339 MB
- `.tmp/adb-returnreact.log`: 318 MB
- `.tmp/unity-linux-runtime.tar`: 204 MB
- çeşitli log ve ekran görüntüleri

Yorum:

- Tamamı geçici çalışma/artifact alanı.
- Repoda tutulmamalı.
- Silinmesi güvenli.

### `tmp-build`

- `tmp-build/AndroidUnityLibraryExport`: 773 MB

Yorum:

- Tamamı generated export/build içeriği.
- Silinmesi güvenli.

### `Unity`

Kırılım:

- `Unity/Render`: 1.17 GB
- `Unity/Headless`: 1.11 GB
- `Unity/LinuxBuild`: 203 MB
- `Unity/match-viewer`: 191 MB

Yorum:

- `Unity/Headless/Assets/Scripts` aktif kaynak kod.
- `Unity/Render/Source` aktif kaynak kod.
- `Unity/match-viewer` web viewer kaynağı gibi davranıyor ve `public/Unity` buradan kopyalanıyor.
- Ama `Unity/Headless/Build`, `Unity/Render/Build`, `Unity/LinuxBuild` tamamıyla build artifact.
- Bu build klasörlerinde `GameAssembly.so`, `UnityPlayer.so`, `*_BackUpThisFolder_ButDontShipItWithYourGame`, `il2cppOutput`, `*_Data` gibi çıktılar yer alıyor; bunlar repoda tutulmamalı.

### `public`, `dist`, `ios`

Kırılım:

- `public/Unity`: 191 MB
- `dist/Unity`: 191 MB
- `ios/App/App/public`: 356 MB

Yorum:

- `public/Unity` kaynağı `Unity/match-viewer`dan script ile kopyalanıyor; tek kaynak olmasına gerek varsa biri seçilmeli.
- `dist` build çıktısıdır, tutulmamalı.
- `ios/App/App/public` generated Capacitor web asset kopyasıdır; `ios/.gitignore` zaten ignore ediyor.

### Alt projeler

- `src/functions/node_modules`: 116 MB
- `services/match-control-api/node_modules`: 65 MB
- `services/node-agent/node_modules`: 6.7 MB

Yorum:

- Bunların hiçbiri repoda tutulmamalı.
- Alt proje `.gitignore` dosyaları kısmen doğru, ama kök repo seviyesinde de net ignore kuralları olmalı.

### Log ve test çıktıları

Örnek büyük dosyalar:

- `docs/benchmark-reports/android-live-watch-20260310-1700-logcat.txt`: 65 MB
- `firebase-debug.log`: 6.3 MB
- `render-test.mp4`: 8.2 MB
- kökteki `unity_*`, `logcat_*`, `friendly_*` log dosyaları

Yorum:

- Bunlar kaynak değil.
- Doküman olarak tutulacaksa seçilmiş küçük örnekler kalmalı; tam log dump’ları repoya girmemeli.

## 4. Güvenle silinebilecekler

Kod mimarisine göre bunlar güvenle silinebilir:

- `.tmp/`
- `tmp-build/`
- `dist/`
- root `node_modules/`
- `src/functions/node_modules/`
- `services/match-control-api/node_modules/`
- `services/node-agent/node_modules/`
- `android/app/build/`
- `android/unityLibrary/build/`
- `android/unityLibrary/symbols/`
- `android/_unity_patch_backup/`
- `android/.gradle/`
- `android/build/`
- `android/.idea/`
- `ios/App/App/public/`
- `ios/App/Pods/`
- `ios/App/build/`
- `ios/DerivedData/`
- tüm `*.apk`, `*.aab`
- tüm büyük loglar: `*log*`, `friendly_*`, `unity_*`, `logcat_*`
- test video/screenshot çıktıları: `render-test.mp4`, `.png` cihaz ekran görüntüleri

## 5. Dikkatli karar verilmesi gerekenler

### `public/Unity`

Bu klasör generated kopya. `scripts/copy-unity.mjs` bunu `Unity/match-viewer`dan üretir.

Tercih:

- tek kaynak olarak `Unity/match-viewer` kalsın
- `public/Unity` Git dışında olsun
- build öncesi kopyalama scripti bunu üretsin

Not:

- Şu an kök `.gitignore` sadece `public/Unity/**/*.wasm`, `*.data`, `*.bundle` gibi bazı pattern’leri ignore ediyor.
- Ama `public/Unity/**/*.unityweb`, `index.html`, `TemplateData/*` gibi dosyalar hâlâ track edilebiliyor.

### `android/unityLibrary/src/main`

Bu klasör komple çöpe atılacak alan değil. Android Unity Library kaynağı burada.

Ama aşağıdakiler generated export tarafı:

- `android/unityLibrary/src/main/Il2CppOutputProject/`
- `android/unityLibrary/src/main/jniLibs/`
- `android/unityLibrary/src/main/jniStaticLibs/`
- `android/unityLibrary/src/main/assets/aa/`

Eğer Android Unity export repo içinde kaynak olarak tutulmayacaksa bunlar da dışarı alınmalı veya export scripti ile yeniden üretilebilir hale getirilmeli.

Bugünkü mimaride ise `android/unityLibrary` doğrudan build zincirine bağlı olduğu için bunu kaldırmadan önce üretim akışı netleştirilmeli.

## 6. Silinmemesi gerekenler

Şunlar aktif kaynak veya yapılandırma olarak korunmalı:

- `src/`
- `public/legend-images` ve gerçek statik web asset’ler
- `Unity/Headless/Assets/Scripts`
- `Unity/Render/Source`
- `Unity/match-viewer` kaynağı
- `android/app/src/main/java`, `AndroidManifest`, Gradle dosyaları
- `android/unityLibrary/build.gradle`
- `android/unityLibrary/src/main/java`
- `ios/App/AppDelegate.swift`, Xcode proje dosyaları
- `services/*/src`
- `src/functions/src`

## 7. Git için önerilen ignore alanları

Mevcut `.gitignore` yeterli değil. Özellikle şu alanlar açıkta kalmış:

- `.tmp/`
- `tmp-build/`
- `android/_unity_patch_backup/`
- `android/unityLibrary/build/`
- `android/unityLibrary/symbols/`
- `android/unityLibrary/src/main/Il2CppOutputProject/`
- `android/unityLibrary/src/main/jniLibs/`
- `android/unityLibrary/src/main/jniStaticLibs/`
- `Unity/**/Build/`
- `Unity/LinuxBuild/`
- `public/Unity/`
- `ios/App/App/public/`
- `docs/benchmark-reports/*.txt`
- `*.mp4`
- `*.tar`
- `*.tar.gz`
- `*.traceevents`
- `*.dbg.so`
- `*.sym.so`
- `friendly_*.txt`
- `unity_*.txt`
- `logcat_*.txt`

Öneri:

1. Eğer `Unity/match-viewer` kaynak kabul edilecekse `public/Unity/` komple ignore edilmeli.
2. Eğer Android Unity export repo içinde tutulmayacaksa `android/unityLibrary/src/main/Il2CppOutputProject`, `jniLibs`, `jniStaticLibs`, `assets/aa` da ignore edilmeli.
3. Unity Linux build çıktıları kesinlikle ignore edilmeli.

## 8. GitHub push riski

Şu an Git durumu ciddi şekilde şişmiş:

- `.git` yaklaşık 2.98 GB
- `git count-objects -vH` çıktısında `size-pack: 1.78 GiB`
- artifact/log/export bölgelerinde yaklaşık 8161 track edilmiş dosya var

Mevcut tracked büyük dosya örnekleri:

- `android/unityLibrary/symbols/arm64-v8a/libil2cpp.so`: 470.65 MB
- `android/unityLibrary/symbols/armeabi-v7a/libil2cpp.so`: 375.12 MB
- `.tmp/unity-linux-runtime.tar`: 203.74 MB

Bu boyutlar GitHub için doğrudan problem çıkarır. Özellikle 100 MB üstü blob’lar push sırasında reddedilir.

Önemli nokta:

- Dosyayı klasörden silmek tek başına yetmez.
- Eğer bu dosyalar commit geçmişine girdiyse, Git geçmişi de temizlenmelidir.

## 9. Hızlı aksiyon planı

Önerilen sıra:

1. Önce `.tmp`, `tmp-build`, `dist`, tüm `node_modules`, Android build klasörleri, Unity build klasörleri ve log/video çıktıları working tree’den kaldır.
2. `.gitignore` dosyasını genişlet.
3. Daha önce track edilmiş dosyaları `git rm --cached` ile index’ten çıkar.
4. Hâlâ geçmişte 100 MB üstü blob varsa `git filter-repo` veya BFG ile history temizliği yap.
5. Sonra temiz bir ilk push yap.

## 10. Kısa karar özeti

Kesin sil:

- build klasörleri
- `.tmp`
- `tmp-build`
- tüm `node_modules`
- log/video/test dump dosyaları
- Android symbols ve backup klasörleri

Koşullu sil:

- `public/Unity`
- `ios/App/App/public`
- Android içindeki generated Unity export alt klasörleri

Tut:

- React kaynak kodu
- mobil proje yapılandırmaları
- `Unity` içindeki gerçek kaynak script/scene tarafı
- `android/unityLibrary`nin build zinciri için zorunlu kaynak kısmı
