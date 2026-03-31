# Android Zorunlu Guncelleme

## Firestore config dokumani
`public_config/mobile_update` dokumani olustur:

```json
{
  "android": {
    "latestVersionCode": 2026032801,
    "latestVersionName": "1.0.17",
    "minSupportedVersionCode": 2026032801,
    "forceImmediateUpdate": true,
    "gateMode": "enforce",
    "storeUrl": "https://play.google.com/store/apps/details?id=com.nerbuss.fhsmanager",
    "blockTitle": "Guncelleme gerekli",
    "blockMessage": "Devam etmek icin uygulamanin en son surumunu yukleyin."
  }
}
```

## Release akisi
1. Yeni AAB'yi Play Console'a yukle.
2. Surumun kullanicilara ulasabilir oldugunu dogrula.
3. Yalnizca bildirim gostermek istiyorsan `latestVersionCode` ve `latestVersionName` guncelle.
4. Zorunlu guncelleme istiyorsan `minSupportedVersionCode` alanini yeni surume cek.
5. Staged rollout yapiyorsan `minSupportedVersionCode` alanini rollout tamamlanmadan yukseltme.

## Beklenen davranis
- `installedVersionCode < minSupportedVersionCode` ise uygulama bloklanir.
- `installedVersionCode >= minSupportedVersionCode` ise surum kapisini gecer.
- Play Immediate update acilabiliyorsa resmi Google Play guncelleme akisi baslar.
- Immediate update acilamiyorsa kullanici Play Store listeleme sayfasina yonlendirilir.
