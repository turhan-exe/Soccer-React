## Google Play Billing setup

### Kodda beklenen urun kimlikleri

Play Console > Monetize > Products > In-app products altinda su one-time urunleri olustur:

- `diamonds_small` -> `200` elmas
- `diamonds_medium` -> `900` elmas
- `diamonds_large` -> `2800` elmas
- `diamonds_mega` -> `6000` elmas

Kod bu kimlikleri kullanir. Farkli urun ID kullanacaksan `src/features/diamonds/packs.ts` dosyasini guncelle.

### Deploy adimlari

Repo kokunden:

```powershell
npm run build
npx cap sync android
cd src/functions
npm run build
firebase deploy --only functions:finalizeAndroidDiamondPurchase
firebase deploy --only firestore:rules
```

### Play Console API access

`finalizeAndroidDiamondPurchase` callable'i Google Play Developer API ile satin almayi dogrular ve tuketir.

Play Console tarafinda:

1. `Play Console > Setup > API access`
2. Bir Google Cloud service account bagla veya mevcut service account'u kullan
3. Bu service account'a uygulama erisimi ver
4. Su izinleri ver:
   - `View financial data, orders, and cancellation survey responses`
   - `Manage orders and subscriptions`

### Test

1. Internal testing kanalina yeni build yukle
2. Test kullanicisini ekle
3. Play Store'dan test build'ini yukle
4. Elmas magazasinda fiyatlarin doldugunu dogrula
5. Satin alma sonrasi `users/{uid}/diamondPurchases/{purchaseId}` kaydini ve `diamondBalance` artisina bak

### Notlar

- `firestore.rules` icinde `diamondPurchases` artik client tarafindan yazilamaz.
- Satin alma basarili olup tuketim sonradan fail olursa, magazayi tekrar acmak bekleyen satin almalari yeniden senkronize eder.
