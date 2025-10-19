import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings, Moon, Volume2, Trash2, Download, Image, Loader2, Gift, Crown, Phone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { updateTeamLogo, renameClubWithDiamonds, renameStadiumWithDiamonds, getTeam } from '@/services/team';
import { updateUserContactInfo } from '@/services/users';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MAX_LOGO_SIZE = 512 * 1024; // 512KB
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
const CLUB_RENAME_COST = 300;
const STADIUM_RENAME_COST = 220;
const MIN_RENAME_LENGTH = 3;
const MAX_RENAME_LENGTH = 32;

export default function SettingsPage() {
  const { theme } = useTheme();
  const { user, refreshTeamInfo } = useAuth();
  const { balance } = useDiamonds();
  const [logoPreview, setLogoPreview] = useState<string | null>(user?.teamLogo ?? null);
  const [isSavingLogo, setIsSavingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const acceptedLogoTypes = ACCEPTED_LOGO_TYPES.join(',');
  const [isClubRenameOpen, setIsClubRenameOpen] = useState(false);
  const [isStadiumRenameOpen, setIsStadiumRenameOpen] = useState(false);
  const [clubNameInput, setClubNameInput] = useState('');
  const [stadiumNameInput, setStadiumNameInput] = useState('');
  const [isRenamingClub, setIsRenamingClub] = useState(false);
  const [isRenamingStadium, setIsRenamingStadium] = useState(false);
  const [stadiumName, setStadiumName] = useState<string | null>(null);
  const [contactPhone, setContactPhone] = useState(user?.contactPhone ?? '');
  const [contactCrypto, setContactCrypto] = useState(user?.contactCrypto ?? '');
  const [isSavingContact, setIsSavingContact] = useState(false);
  const navigate = useNavigate();
  const {
    lastDailyRewardDate,
    processDailyReward,
    vipStatus,
    vipActive,
    vipPlans,
    deactivateVip,
    claimMonthlyStarCard,
    canClaimMonthlyStarCard,
    isHydrated,
  } = useInventory();

  const formatOptionalDate = (value: string | null, options?: { dateOnly?: boolean }) => {
    if (!value) {
      return 'Henuz alinmadi';
    }
    const source = options?.dateOnly ? `${value}T00:00:00Z` : value;
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) {
      return 'Bilinmiyor';
    }
    return parsed.toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const lastDailyRewardLabel = formatOptionalDate(lastDailyRewardDate, { dateOnly: true });
  const lastMonthlyStarCardLabel = formatOptionalDate(vipStatus.lastMonthlyStarCardDate);
  const vipExpiryLabel = formatOptionalDate(vipStatus.expiresAt);
  const vipPlanLabel = vipStatus.plan ? vipPlans[vipStatus.plan].label : 'Secilmedi';
  const todayKey = new Date().toISOString().split('T')[0];
  const hasClaimedToday = lastDailyRewardDate === todayKey;
  const vipDurationPercent = Math.round((vipStatus.durationReductionPercent ?? 0) * 100);
  const isVipActive = vipActive;
  const monthlyButtonLabel = canClaimMonthlyStarCard ? 'Aylik karti al' : 'Aylik kart alindi';
  const starCardCredits = vipStatus.starCardCredits ?? 0;
  const isLoggedIn = Boolean(user);
  const canInteract = isLoggedIn && isHydrated;
  const normalizedStoredPhone = user?.contactPhone?.trim() ?? '';
  const normalizedStoredCrypto = user?.contactCrypto?.trim() ?? '';
  const normalizedPhoneInput = contactPhone.trim();
  const normalizedCryptoInput = contactCrypto.trim();
  const hasContactChanges =
    normalizedPhoneInput !== normalizedStoredPhone || normalizedCryptoInput !== normalizedStoredCrypto;

  useEffect(() => {
    setLogoPreview(user?.teamLogo ?? null);
  }, [user?.teamLogo]);
  useEffect(() => {
    setContactPhone(user?.contactPhone ?? '');
    setContactCrypto(user?.contactCrypto ?? '');
  }, [user?.contactPhone, user?.contactCrypto]);
  useEffect(() => {
    if (!user) {
      setStadiumName(null);
      return;
    }

    let isMounted = true;
    const loadStadiumName = async () => {
      try {
        const team = await getTeam(user.id);
        if (!isMounted) return;
        setStadiumName(team?.stadium?.name ?? null);
      } catch (error) {
        console.warn('[Settings] Failed to load stadium name', error);
      }
    };

    void loadStadiumName();
    return () => {
      isMounted = false;
    };
  }, [user]);


  const handleClubRename = async () => {
    if (!user) {
      toast.error('Oturum bulunamadi.');
      return;
    }
    const trimmed = clubNameInput.trim();
    if (trimmed.length < MIN_RENAME_LENGTH) {
      toast.error(`Kulup adi en az ${MIN_RENAME_LENGTH} karakter olmalidir.`);
      return;
    }
    if (trimmed.length > MAX_RENAME_LENGTH) {
      toast.error(`Kulup adi en fazla ${MAX_RENAME_LENGTH} karakter olabilir.`);
      return;
    }
    if (trimmed === (user.teamName ?? '').trim()) {
      toast.error('Yeni isim mevcut isim ile ayni.');
      return;
    }
    if (balance < CLUB_RENAME_COST) {
      toast.error('Yetersiz elmas bakiyesi.');
      return;
    }

    setIsRenamingClub(true);
    try {
      await renameClubWithDiamonds(trimmed);
      toast.success('Kulup adi guncellendi.');
      setClubNameInput('');
      setIsClubRenameOpen(false);
      await refreshTeamInfo();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kulup adi guncellenemedi.';
      toast.error(message);
    } finally {
      setIsRenamingClub(false);
    }
  };

  const handleStadiumRename = async () => {
    if (!user) {
      toast.error('Oturum bulunamadi.');
      return;
    }
    const trimmed = stadiumNameInput.trim();
    if (trimmed.length < MIN_RENAME_LENGTH) {
      toast.error(`Stadyum adi en az ${MIN_RENAME_LENGTH} karakter olmalidir.`);
      return;
    }
    if (trimmed.length > MAX_RENAME_LENGTH) {
      toast.error(`Stadyum adi en fazla ${MAX_RENAME_LENGTH} karakter olabilir.`);
      return;
    }
    if (trimmed === (stadiumName ?? '').trim()) {
      toast.error('Yeni stadyum adi ayni gorunuyor.');
      return;
    }
    if (balance < STADIUM_RENAME_COST) {
      toast.error('Yetersiz elmas bakiyesi.');
      return;
    }

    setIsRenamingStadium(true);
    try {
      await renameStadiumWithDiamonds(trimmed);
      toast.success('Stadyum adi guncellendi.');
      setStadiumName(trimmed);
      setStadiumNameInput('');
      setIsStadiumRenameOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stadyum adi guncellenemedi.';
      toast.error(message);
    } finally {
      setIsRenamingStadium(false);
    }
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error('Logo dönüştürülemedi.'));
        }
      };
      reader.onerror = () => reject(new Error('Logo okunurken bir hata oluştu.'));
      reader.readAsDataURL(file);
    });

  const handleLogoUpload = async (file: File) => {
    if (!user) {
      toast.error('Logo yüklemek için giriş yapmalısın.');
      return;
    }

    const fileType = file.type?.toLowerCase();
    if (!fileType || !ACCEPTED_LOGO_TYPES.includes(fileType)) {
      toast.error('Desteklenmeyen dosya formatı.', {
        description: 'Lütfen PNG, JPG veya SVG formatında bir görsel yükleyin.',
      });
      return;
    }

    if (file.size > MAX_LOGO_SIZE) {
      toast.error('Logo dosyası çok büyük.', {
        description: '512 KB\'dan küçük bir görsel seçmelisin.',
      });
      return;
    }

    setIsSavingLogo(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await updateTeamLogo(user.id, dataUrl);
      setLogoPreview(dataUrl);
      toast.success('Takım logon başarıyla güncellendi.');
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Logo update failed', error);
      toast.error('Logo kaydedilemedi.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSavingLogo(false);
    }
  };

  const handleLogoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    await handleLogoUpload(file);
  };

  const handleRemoveLogo = async () => {
    if (!user) {
      return;
    }
    setIsSavingLogo(true);
    try {
      await updateTeamLogo(user.id, null);
      setLogoPreview(null);
      toast.success('Takım logon kaldırıldı.');
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Logo remove failed', error);
      toast.error('Logo kaldırılırken bir hata oluştu.', {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSavingLogo(false);
    }
  };

  const handleSaveContactInfo = async () => {
    if (!user) {
      toast.error('Iletisim bilgilerini kaydetmek icin oturum acmalisin.');
      return;
    }

    if (!hasContactChanges) {
      return;
    }

    setIsSavingContact(true);
    try {
      await updateUserContactInfo(user.id, {
        phone: normalizedPhoneInput || null,
        crypto: normalizedCryptoInput || null,
      });
      toast.success('Iletisim bilgileri guncellendi.');
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Failed to update contact info', error);
      toast.error('Iletisim bilgileri kaydedilemedi.');
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleResetContactInfo = () => {
    setContactPhone(user?.contactPhone ?? '');
    setContactCrypto(user?.contactCrypto ?? '');
  };

  const openFileDialog = () => {
    if (!isSavingLogo) {
      fileInputRef.current?.click();
    }
  };

  const handleClearCache = () => {
    toast.success('Önbellek temizlendi');
  };

  const handleExportData = () => {
    toast.success('Veriler dışa aktarıldı');
  };

  const cardBaseClass = 'border-white/10 bg-slate-900/60 text-slate-100 backdrop-blur-lg';

  return (
    <>
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute right-[-20%] bottom-[-25%] h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col gap-6 px-4 py-8 sm:px-6 lg:px-10">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:p-6 backdrop-blur-lg">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BackButton />
              <div>
                <h1 className="text-3xl font-bold">Ayarlar</h1>
                <p className="mt-1 text-sm text-slate-300">
                  Kulübünü kişiselleştir, bildirim tercihlerini düzenle ve verilerini yönet.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 shadow-lg">
              <Moon className="h-4 w-4" />
              <span>Tema: {theme === 'dark' ? 'Koyu' : 'Açık'}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Image className="h-5 w-5 text-emerald-300" />
                Takım Kimliği
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-300">
                Logonu yükleyerek kulübünü diğer menajerlerden ayır. PNG, JPG veya SVG formatında en fazla 512 KB boyutunda bir
                görsel seçebilirsin.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptedLogoTypes}
                className="hidden"
                onChange={handleLogoFileChange}
              />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-emerald-300/30 bg-slate-950/70 shadow-inner">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Takım logosu" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-3xl">⚽</span>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={openFileDialog}
                      disabled={!user || isSavingLogo}
                      className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    >
                      {isSavingLogo ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Kaydediliyor
                        </>
                      ) : (
                        'Logo Yükle'
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={handleRemoveLogo}
                      disabled={!user || isSavingLogo || !logoPreview}
                      className="text-slate-300 hover:text-emerald-100"
                    >
                      Logoyu Kaldır
                    </Button>
                  </div>
                  <p className="text-xs text-slate-400">
                    {user?.teamName ?? 'Takımın'} logosu yenilendiğinde üst menüde ve diğer sayfalarda otomatik olarak güncellenir.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-emerald-300" />
                Kulup ve Stadyum Adi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm text-slate-300">Kulup adi: <span className="font-semibold text-emerald-200">{user?.teamName ?? 'Takimim'}</span></p>
                <p className="text-xs text-slate-400">Degistirme maliyeti: {CLUB_RENAME_COST} elmas</p>
                <Button
                  variant="secondary"
                  className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                  onClick={() => {
                    setClubNameInput(user?.teamName ?? '');
                    setIsClubRenameOpen(true);
                  }}
                >
                  Kulup adini degistir
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-sm text-slate-300">Stadyum adi: <span className="font-semibold text-emerald-200">{stadiumName ?? 'Stadyumunuz'}</span></p>
                <p className="text-xs text-slate-400">Degistirme maliyeti: {STADIUM_RENAME_COST} elmas</p>
                <Button
                  variant="outline"
                  className="border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20"
                  onClick={() => {
                    setStadiumNameInput(stadiumName ?? '');
                    setIsStadiumRenameOpen(true);
                  }}
                >
                  Stadyum adini degistir
                </Button>
              </div>

              <p className="text-xs text-slate-400">Mevcut bakiye: <span className="font-semibold text-emerald-200">{balance}</span> elmas</p>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5 text-emerald-300" />
                Iletisim Bilgileri
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-300">
                Diger menajerlerin sana ulasmasi icin iletisim kanallarini kaydet. Bu bilgiler yalnizca paylasim
                izninle goruntulenir.
              </p>
              <div className="space-y-2">
                <Label htmlFor="contact-phone" className="text-xs uppercase tracking-wide text-emerald-200/70">
                  Telefon numarasi
                </Label>
                <Input
                  id="contact-phone"
                  value={contactPhone}
                  onChange={event => setContactPhone(event.target.value)}
                  placeholder="+90 555 000 00 00"
                  inputMode="tel"
                  disabled={!user || isSavingContact}
                />
                <p className="text-xs text-slate-400">
                  Numarani uluslararasi formatta yazabilirsin. Kaydettiginde yalnizca kulubun resmi iletisim kanalindan paylasilir.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact-crypto" className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-200/70">
                  <Wallet className="h-4 w-4" />
                  Kripto hesabi
                </Label>
                <Input
                  id="contact-crypto"
                  value={contactCrypto}
                  onChange={event => setContactCrypto(event.target.value)}
                  placeholder="USDT (TRC20) cuzdan adresi"
                  disabled={!user || isSavingContact}
                />
                <p className="text-xs text-slate-400">
                  Kripto odemeleri icin tercih ettigin cuzdan adresini veya borsa hesap bilgisini ekleyebilirsin.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-slate-300 hover:text-emerald-100"
                  onClick={handleResetContactInfo}
                  disabled={!hasContactChanges || isSavingContact}
                >
                  Alanlari sifirla
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveContactInfo}
                  disabled={!user || isSavingContact || !hasContactChanges}
                  className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                >
                  {isSavingContact ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Kaydediliyor
                    </>
                  ) : (
                    'Bilgileri kaydet'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Moon className="h-5 w-5 text-emerald-300" />
                Görünüm
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-300">
                Oyun deneyimini tutarlı kılmak için koyu tema varsayılan hale getirildi ve tüm kullanıcılar için etkin.
              </p>
              <p className="text-xs text-slate-400">
                Sistem temandan bağımsız olarak arayüz koyu modda açılır. Gelecekteki güncellemelerde farklı tema seçenekleri
                eklenebilir.
              </p>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Gift className="h-5 w-5 text-emerald-300" />
                Gunluk Oduller ve VIP
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/5 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">Gunluk giris odulu</p>
                    <p className="text-sm text-slate-300">
                      Her giriste enerji, moral veya saglik kitlerinden biri otomatik olarak eklenir.
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      Son odul tarihi:{' '}
                      <span className="font-medium text-emerald-200">{lastDailyRewardLabel}</span>
                    </p>
                  </div>
                  <Button
                    onClick={processDailyReward}
                    disabled={!canInteract || hasClaimedToday}
                    variant="outline"
                    className="mt-2 w-full border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20 sm:mt-0 sm:w-auto"
                  >
                    {hasClaimedToday ? 'Bugun alindi' : 'Odulu kontrol et'}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-300/20 bg-slate-900/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Crown className={`h-5 w-5 ${isVipActive ? 'text-amber-300' : 'text-slate-500'}`} />
                      <p className="font-semibold text-slate-100">
                        VIP durumu:{' '}
                        <span className={isVipActive ? 'text-amber-300' : 'text-slate-300'}>
                          {isVipActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </p>
                    </div>
                    <div className="text-sm text-slate-300">
                      <p>- Gunluk +1 enerji, moral ve saglik kiti</p>
                      <p>- Sureler %{vipDurationPercent} kisalir</p>
                      <p>- Ayda 1 yildiz oyuncu karti</p>
                    </div>
                    <div className="text-xs text-slate-400">
                      <p>
                        Secili paket:{' '}
                        <span className="font-medium text-emerald-200">{vipPlanLabel}</span>
                      </p>
                      <p>
                        VIP bitis:{' '}
                        <span className="font-medium text-emerald-200">{vipExpiryLabel}</span>
                      </p>
                      <p>
                        Son yildiz karti:{' '}
                        <span className="font-medium text-emerald-200">{lastMonthlyStarCardLabel}</span>
                      </p>
                      <p>
                        Kart kredisi:{' '}
                        <span className="font-medium text-emerald-200">{starCardCredits}</span>
                      </p>
                    </div>
                  </div>
                  {isVipActive ? (
                    <div className="flex w-full flex-col gap-2 sm:w-auto">
                      <Button
                        onClick={claimMonthlyStarCard}
                        disabled={!canInteract || !canClaimMonthlyStarCard}
                        className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                      >
                        {monthlyButtonLabel}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => navigate('/store/vip')}
                        disabled={!canInteract}
                        className="border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20"
                      >
                        VIP paketlerini goruntule
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={deactivateVip}
                        disabled={!canInteract}
                        className="text-slate-300 hover:text-emerald-100"
                      >
                        VIP devre disi
                      </Button>
                    </div>
                  ) : (
                    <div className="flex w-full flex-col gap-2 sm:w-auto">
                      <Button
                        onClick={() => navigate('/store/vip')}
                        disabled={!canInteract}
                        className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                      >
                        VIP paketlerini goruntule
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle>Bildirimler</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Maç Bildirimleri</Label>
                  <p className="text-sm text-slate-400">Maç başlamadan önce bildirim al</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Antrenman Bildirimleri</Label>
                  <p className="text-sm text-slate-400">Antrenman tamamlandığında bildirim al</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Transfer Bildirimleri</Label>
                  <p className="text-sm text-slate-400">Transfer döneminde fırsatlar için bildirim al</p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-emerald-300" />
                Ses ve Performans
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Ses Efektleri</Label>
                  <p className="text-sm text-slate-400">Maç sırasında ses efektlerini oynat</p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Animasyonlar</Label>
                  <p className="text-sm text-slate-400">Geçiş animasyonlarını azalt</p>
                </div>
                <Switch />
              </div>

              <div className="space-y-2">
                <Label>Grafik Kalitesi</Label>
                <Select defaultValue="high">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Düşük</SelectItem>
                    <SelectItem value="medium">Orta</SelectItem>
                    <SelectItem value="high">Yüksek</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle>Dil ve Bölge</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Dil</Label>
                <Select defaultValue="tr">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tr">Türkçe</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Para Birimi</Label>
                <Select defaultValue="try">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="try">Türk Lirası (₺)</SelectItem>
                    <SelectItem value="eur">Euro (€)</SelectItem>
                    <SelectItem value="usd">US Dollar ($)</SelectItem>
                    <SelectItem value="gbp">British Pound (£)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-emerald-300" />
                Veri Yönetimi
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
                  onClick={handleExportData}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Verileri Dışa Aktar
                </Button>

                <Button
                  variant="outline"
                  className="w-full justify-start border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
                  onClick={handleClearCache}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Önbelleği Temizle
                </Button>
              </div>

              <div className="border-t border-white/10 pt-4">
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between">
                    <span>Oyun Verisi:</span>
                    <span>2.4 MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Önbellek:</span>
                    <span>15.8 MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Toplam:</span>
                    <span>18.2 MB</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className={cardBaseClass}>
          <CardHeader>
            <CardTitle>Hakkında</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Versiyon:</span>
                <span>1.0.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Son Güncelleme:</span>
                <span>18 Ağustos 2025</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Geliştirici:</span>
                <span>Turhan KAYAER</span>
              </div>
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <div className="space-y-2">
                <Button variant="ghost" className="w-full justify-start text-sm text-slate-200 hover:text-emerald-100">
                  Gizlilik Politikası
                </Button>
                <Button variant="ghost" className="w-full justify-start text-sm text-slate-200 hover:text-emerald-100">
                  Kullanım Şartları
                </Button>
                <Button variant="ghost" className="w-full justify-start text-sm text-slate-200 hover:text-emerald-100">
                  Destek
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>

    <Dialog
      open={isClubRenameOpen}
      onOpenChange={open => {
        setIsClubRenameOpen(open);
        if (!open) {
          setClubNameInput('');
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kulup adini guncelle</DialogTitle>
          <DialogDescription>
            Yeni kulup adini gir ve {CLUB_RENAME_COST} elmas ile onayla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="club-name">Kulup adi</Label>
          <Input
            id="club-name"
            value={clubNameInput}
            onChange={event => setClubNameInput(event.target.value)}
            placeholder={user?.teamName ?? 'Takimin'}
            maxLength={MAX_RENAME_LENGTH}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setIsClubRenameOpen(false)}>
            Vazgec
          </Button>
          <Button onClick={handleClubRename} disabled={isRenamingClub}>
            {isRenamingClub ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Onayla ({CLUB_RENAME_COST})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={isStadiumRenameOpen}
      onOpenChange={open => {
        setIsStadiumRenameOpen(open);
        if (!open) {
          setStadiumNameInput('');
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stadyum adini guncelle</DialogTitle>
          <DialogDescription>
            Yeni stadyum adini gir ve {STADIUM_RENAME_COST} elmas ile onayla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="stadium-name">Stadyum adi</Label>
          <Input
            id="stadium-name"
            value={stadiumNameInput}
            onChange={event => setStadiumNameInput(event.target.value)}
            placeholder={stadiumName ?? 'Stadyum'}
            maxLength={MAX_RENAME_LENGTH}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => setIsStadiumRenameOpen(false)}>
            Vazgec
          </Button>
          <Button onClick={handleStadiumRename} disabled={isRenamingStadium}>
            {isRenamingStadium ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Onayla ({STADIUM_RENAME_COST})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}
