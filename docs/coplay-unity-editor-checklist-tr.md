# Coplay Prompt (Unity Editor / Prefab Kontrolleri) - Dostluk Maçı Otomatik Başlatma

Aşağıdaki işleri Unity Editor içinde kontrol et ve yaptığın değişiklikleri tek tek Türkçe raporla.

## Amaç
Mobil uygulamadan dostluk maçı kabul edilince:
1. Unity client otomatik bağlansın
2. Gerçek takımlar upcoming ekranda görünsün
3. En az 1 remote client geldiğinde 10 saniye geri sayım başlasın
4. Geri sayım sonunda maç otomatik başlasın (manuel buton tıklaması olmasın)

## Kod tarafında zaten yapılmış kabul et (tekrar yazma)
- Match ticket auth / sessionSecret imza düzeltmesi (backend)
- MatchNetworkManager içinde auto request, countdown mesajı, auto host start gate
- MainMenuPanel.Play() network bağlıysa SendMatchRequest(home, away)
- UpcomingMatchPanel countdown text API (SetAutoStartCountdown / ClearAutoStartCountdown)

## Unity Editor'de kontrol etmen gerekenler
### 1) Sahne objeleri / script referansları
- `MatchNetworkManager` objesinde şu referanslar dolu mu kontrol et:
  - `matchManagerPrefab`
  - `manualNetworkPlayer`
  - `manualPlayerPrefab`
  - `manualBallLoader`
  - `ipInputField` (varsa)
  - `statusText` (varsa)
- `requiredRemoteClientsToStart = 1`
- `autoStartWhenRemoteClientJoins = true`
- `autoStartCountdownSeconds = 10`

### 2) Upcoming panel referansları
- `UpcomingMatchPanel` prefab/scene instance üzerinde:
  - `teams[0]` dolu
  - `teams[1]` dolu
  - `difficultyText` atanmış mı (boşsa countdown UI görünmez)

### 3) Main menu / team selection referansları
- `MainMenuPanel` üzerinde:
  - `homeTeam` referansı dolu
  - `awayTeam` referansı dolu
- `TeamSelectionTeam` komponentleri runtime team set edildiğinde görseli/ismi güncelliyor mu kontrol et

### 4) Network authenticator / manager wiring
- Kullanılan `NetworkManager` objesinde `MatchTicketAuthenticator` doğru takılı mı
- Authenticator client/server message registration aktif mi
- `MatchNetworkManager` gerçekten sahnedeki aktif singleton mı (duplike instance var mı)

### 5) Mobile launch akışı (Android client build sahnesi)
- Android buildde açılan ilk sahnede `MatchNetworkManager` var mı
- `NetworkConnectionUI` varsa mobile auto-connect akışını blokluyor mu
- Manual test UI butonları görünse bile auto-connect sonrası flow devam ediyor mu

### 6) Upcoming -> Match start otomasyonu
- Host/client bağlandıktan sonra `UpcomingMatchPanel` açılıyor mu
- Geri sayım metni `difficultyText` üzerinde görünüyor mu
- 10 saniye sonunda `StartMatch()` otomatik tetikleniyor mu
- Manuel butona basmadan match engine load başlıyor mu

### 7) Takım çözümleme kontrolü
- Gelen `homeTeamId/awayTeamId` değerleri Unity `TeamEntry.TeamName` ile eşleşiyor mu
- Eşleşmiyorsa hangi alan eşleşiyor (slug / display name / short name) not al
- Gerekirse Unity DB tarafında alias/normalization ihtiyacını raporla

## Rapor formatı (Türkçe)
Aşağıdaki başlıklarla cevap ver:
1. Yaptığım Kontroller
2. Bulduğum Sorunlar
3. Editor'de Yaptığım Değişiklikler
4. Hala Kod Gerektiren Konular
5. Test Sonucu (beklenen / gerçekleşen)

## Önemli
- Prefab/sahne kaydı yaptığın her değişikliği isim vererek yaz.
- Atanmamış referansları özellikle belirt.
- “Çalıştı” demeden önce gerçek cihazda dostluk accept akışını test et.
