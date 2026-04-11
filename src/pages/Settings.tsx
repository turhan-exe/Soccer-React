import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  Settings,
  Moon,
  Volume2,
  Trash2,
  Download,
  Image,
  Loader2,
  Gift,
  Crown,
  Phone,
  Wallet,
  ShieldCheck,
  MessageCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import {
  getRewardedAdFailureMessage,
  getRewardedAdsDebugInfo,
  isRewardedAdsSupported,
  openRewardedAdsAdInspector,
  showRewardedAdsPrivacyOptions,
  type RewardedAdsDebugInfo,
} from '@/services/rewardedAds';
import { updateTeamLogo, renameClubWithDiamonds, renameStadiumWithDiamonds, getTeam } from '@/services/team';
import { setNativePushPreference } from '@/services/pushNotifications';
import { updateUserContactInfo, updateUserNotificationPreferences } from '@/services/users';
import { repairLeagueCapacities } from '@/services/admin';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ... imports

const MAX_LOGO_SIZE = 512 * 1024; // 512KB
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
const CLUB_RENAME_COST = 300;
const STADIUM_RENAME_COST = 220;
const MIN_RENAME_LENGTH = 3;
const MAX_RENAME_LENGTH = 32;
const WHATSAPP_SUPPORT_PHONE = '+90 542 693 20 70';
const WHATSAPP_SUPPORT_HREF =
  'https://wa.me/905426932070?text=Merhaba%2C%20oyun%20icinde%20bir%20sorun%20yasadim%20ve%20destek%20almak%20istiyorum.';

export default function SettingsPage() {
  const [isCleaningLeagues, setIsCleaningLeagues] = useState(false);
  const handleCleanLeagues = async () => {
    if (!confirm('Liglerdeki fazlalÄ±k botlar silinecek. Emin misiniz?')) return;

    setIsCleaningLeagues(true);
    try {
      const result = await repairLeagueCapacities();
      toast.success(`Ä°ÅŸlem tamamlandÄ±. ${result.removedBots} bot silindi.`);
      if (result.removedBots > 0) {
        toast.info(`GÃ¼ncellenen ligler: ${result.updatedLeagues.join(', ')}`);
      } else {
        toast.info('TÃ¼m ligler kapasite sÄ±nÄ±rlarÄ± iÃ§inde. Silinecek bot bulunamadÄ±.');
      }
    } catch (error: unknown) {
      console.error(error);
      toast.error(`Hata: ${error instanceof Error ? error.message : 'Temizlik sÄ±rasÄ±nda hata oluÅŸtu.'}`);
    } finally {
      setIsCleaningLeagues(false);
    }
  };
  const { theme } = useTheme();
  const { availableLanguages, formatDate, formatNumber, language, setLanguage, t } = useTranslation();
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
  const [isSavingPushPreference, setIsSavingPushPreference] = useState(false);
  const [isOpeningAdPrivacyOptions, setIsOpeningAdPrivacyOptions] = useState(false);
  const [rewardedAdsDebugInfo, setRewardedAdsDebugInfo] = useState<RewardedAdsDebugInfo | null>(null);
  const [isLoadingRewardedAdsDebugInfo, setIsLoadingRewardedAdsDebugInfo] = useState(false);
  const [isOpeningAdInspector, setIsOpeningAdInspector] = useState(false);
  const navigate = useNavigate();
  const {
    lastDailyRewardDate,
    processDailyReward,
    vipStatus,
    vipActive,
    deactivateVip,
    claimMonthlyStarCard,
    canClaimMonthlyStarCard,
    isHydrated,
  } = useInventory();

  const formatOptionalDate = (value: string | null, options?: { dateOnly?: boolean }) => {
    if (!value) {
      return t('settings.date.notClaimedYet');
    }
    const source = options?.dateOnly ? `${value}T00:00:00Z` : value;
    const parsed = new Date(source);
    if (Number.isNaN(parsed.getTime())) {
      return t('settings.date.unknown');
    }
    return formatDate(parsed, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const lastDailyRewardLabel = formatOptionalDate(lastDailyRewardDate, { dateOnly: true });
  const lastMonthlyStarCardLabel = formatOptionalDate(vipStatus.lastMonthlyStarCardDate);
  const vipExpiryLabel = formatOptionalDate(vipStatus.expiresAt);
  const vipPlanLabel = vipStatus.plan ? t(`common.vipPlans.${vipStatus.plan}`) : t('settings.vip.planNotSelected');
  const todayKey = new Date().toISOString().split('T')[0];
  const hasClaimedToday = lastDailyRewardDate === todayKey;
  const vipDurationPercent = Math.round((vipStatus.durationReductionPercent ?? 0) * 100);
  const isVipActive = vipActive;
  const monthlyButtonLabel = canClaimMonthlyStarCard
    ? t('settings.vip.claimMonthly')
    : t('settings.vip.alreadyClaimedMonthly');
  const starCardCredits = vipStatus.starCardCredits ?? 0;
  const isLoggedIn = Boolean(user);
  const canInteract = isLoggedIn && isHydrated;
  const normalizedStoredPhone = user?.contactPhone?.trim() ?? '';
  const normalizedStoredCrypto = user?.contactCrypto?.trim() ?? '';
  const normalizedPhoneInput = contactPhone.trim();
  const normalizedCryptoInput = contactCrypto.trim();
  const hasContactChanges =
    normalizedPhoneInput !== normalizedStoredPhone || normalizedCryptoInput !== normalizedStoredCrypto;
  const pushEnabled = user?.notificationPrefs?.pushEnabled !== false;
  const showRewardedAdsDebugTools =
    Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === 'android'
    && (import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_BUTTONS === '1');
  const themeLabel = theme === 'dark' ? t('common.themeDark') : t('common.themeLight');
  const aboutLastUpdateLabel = formatDate(new Date('2025-08-18T00:00:00Z'), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

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
      toast.error(t('settings.toasts.sessionMissing'));
      return;
    }
    const trimmed = clubNameInput.trim();
    if (trimmed.length < MIN_RENAME_LENGTH) {
      toast.error(t('settings.toasts.clubTooShort', { min: MIN_RENAME_LENGTH }));
      return;
    }
    if (trimmed.length > MAX_RENAME_LENGTH) {
      toast.error(t('settings.toasts.clubTooLong', { max: MAX_RENAME_LENGTH }));
      return;
    }
    if (trimmed === (user.teamName ?? '').trim()) {
      toast.error(t('settings.toasts.clubSame'));
      return;
    }
    if (balance < CLUB_RENAME_COST) {
      toast.error(t('settings.toasts.insufficientDiamonds'));
      return;
    }

    setIsRenamingClub(true);
    try {
      await renameClubWithDiamonds(trimmed);
      toast.success(t('settings.toasts.clubUpdated'));
      setClubNameInput('');
      setIsClubRenameOpen(false);
      await refreshTeamInfo();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.toasts.clubUpdateFailed');
      toast.error(message);
    } finally {
      setIsRenamingClub(false);
    }
  };

  const handleStadiumRename = async () => {
    if (!user) {
      toast.error(t('settings.toasts.sessionMissing'));
      return;
    }
    const trimmed = stadiumNameInput.trim();
    if (trimmed.length < MIN_RENAME_LENGTH) {
      toast.error(t('settings.toasts.stadiumTooShort', { min: MIN_RENAME_LENGTH }));
      return;
    }
    if (trimmed.length > MAX_RENAME_LENGTH) {
      toast.error(t('settings.toasts.stadiumTooLong', { max: MAX_RENAME_LENGTH }));
      return;
    }
    if (trimmed === (stadiumName ?? '').trim()) {
      toast.error(t('settings.toasts.stadiumSame'));
      return;
    }
    if (balance < STADIUM_RENAME_COST) {
      toast.error(t('settings.toasts.insufficientDiamonds'));
      return;
    }

    setIsRenamingStadium(true);
    try {
      await renameStadiumWithDiamonds(trimmed);
      toast.success(t('settings.toasts.stadiumUpdated'));
      setStadiumName(trimmed);
      setStadiumNameInput('');
      setIsStadiumRenameOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.toasts.stadiumUpdateFailed');
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
          reject(new Error(t('settings.toasts.logoConvertFailed')));
        }
      };
      reader.onerror = () => reject(new Error(t('settings.toasts.logoReadFailed')));
      reader.readAsDataURL(file);
    });

  const handleLogoUpload = async (file: File) => {
    if (!user) {
      toast.error(t('settings.toasts.logoLoginRequired'));
      return;
    }

    const fileType = file.type?.toLowerCase();
    if (!fileType || !ACCEPTED_LOGO_TYPES.includes(fileType)) {
      toast.error(t('settings.toasts.logoUnsupportedTitle'), {
        description: t('settings.toasts.logoUnsupportedDescription'),
      });
      return;
    }

    if (file.size > MAX_LOGO_SIZE) {
      toast.error(t('settings.toasts.logoTooLargeTitle'), {
        description: t('settings.toasts.logoTooLargeDescription'),
      });
      return;
    }

    setIsSavingLogo(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await updateTeamLogo(user.id, dataUrl);
      setLogoPreview(dataUrl);
      toast.success(t('settings.toasts.logoUpdated'));
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Logo update failed', error);
      toast.error(t('settings.toasts.logoSaveFailed'), {
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
      toast.success(t('settings.toasts.logoRemoved'));
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Logo remove failed', error);
      toast.error(t('settings.toasts.logoRemoveFailed'), {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsSavingLogo(false);
    }
  };

  const handleSaveContactInfo = async () => {
    if (!user) {
      toast.error(t('settings.toasts.contactLoginRequired'));
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
      toast.success(t('settings.toasts.contactUpdated'));
      await refreshTeamInfo();
    } catch (error) {
      console.error('[Settings] Failed to update contact info', error);
      toast.error(t('settings.toasts.contactSaveFailed'));
    } finally {
      setIsSavingContact(false);
    }
  };

  const handleResetContactInfo = () => {
    setContactPhone(user?.contactPhone ?? '');
    setContactCrypto(user?.contactCrypto ?? '');
  };

  const handlePushToggle = async (checked: boolean) => {
    if (!user) {
      toast.error(t('settings.toasts.pushLoginRequired'));
      return;
    }

    setIsSavingPushPreference(true);
    try {
      await updateUserNotificationPreferences(user.id, { pushEnabled: checked });
      await setNativePushPreference(user.id, checked);
      await refreshTeamInfo();
      toast.success(
        checked
          ? t('settings.toasts.pushEnabled')
          : t('settings.toasts.pushDisabled'),
      );
    } catch (error) {
      console.error('[Settings] Failed to update push preference', error);
      toast.error(t('settings.toasts.pushSaveFailed'));
    } finally {
      setIsSavingPushPreference(false);
    }
  };

  const openFileDialog = () => {
    if (!isSavingLogo) {
      fileInputRef.current?.click();
    }
  };

  const handleClearCache = () => {
    toast.success(t('settings.toasts.cacheCleared'));
  };

  const handleExportData = () => {
    toast.success(t('settings.toasts.dataExported'));
  };

  const handleOpenWhatsAppSupport = () => {
    if (typeof window === 'undefined') {
      toast.error(t('settings.toasts.whatsappUnavailable'));
      return;
    }

    window.open(WHATSAPP_SUPPORT_HREF, '_blank', 'noopener,noreferrer');
  };

  const handleOpenAdPrivacyOptions = async () => {
    if (!isRewardedAdsSupported()) {
      toast.info(t('settings.toasts.adPrivacyUnsupported'));
      return;
    }

    setIsOpeningAdPrivacyOptions(true);
    try {
      const shown = await showRewardedAdsPrivacyOptions();
      if (shown) {
        toast.success(t('settings.toasts.adPrivacyOpened'));
      } else {
        toast.info(t('settings.toasts.adPrivacyNone'));
      }
    } catch (error) {
      console.error('[Settings] Failed to open rewarded ads privacy options', error);
      toast.error(t('settings.toasts.adPrivacyFailed'));
    } finally {
      setIsOpeningAdPrivacyOptions(false);
    }
  };

  const handleRefreshRewardedAdsDebugInfo = async () => {
    if (!isRewardedAdsSupported()) {
      toast.info(t('settings.toasts.debugUnsupported'));
      return;
    }

    setIsLoadingRewardedAdsDebugInfo(true);
    try {
      const info = await getRewardedAdsDebugInfo();
      setRewardedAdsDebugInfo(info);
      toast.success(t('settings.toasts.debugRefreshed'));
    } catch (error) {
      console.error('[Settings] Failed to load rewarded ads debug info', error);
      toast.error(getRewardedAdFailureMessage(error));
    } finally {
      setIsLoadingRewardedAdsDebugInfo(false);
    }
  };

  const handleOpenAdInspector = async () => {
    if (!isRewardedAdsSupported()) {
      toast.info(t('settings.toasts.inspectorUnsupported'));
      return;
    }

    setIsOpeningAdInspector(true);
    try {
      const result = await openRewardedAdsAdInspector();
      if (result.debug) {
        setRewardedAdsDebugInfo(result.debug);
      }
      if (result.opened) {
        toast.success(t('settings.toasts.inspectorClosed'));
      } else {
        toast.error(getRewardedAdFailureMessage(result.error));
      }
    } catch (error) {
      console.error('[Settings] Failed to open ad inspector', error);
      toast.error(getRewardedAdFailureMessage(error));
    } finally {
      setIsOpeningAdInspector(false);
    }
  };

  const formatDebugTimestamp = (value: number | null) => {
    if (!value || !Number.isFinite(value)) {
      return '-';
    }

    return formatDate(value, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const cardBaseClass = 'border-white/10 bg-slate-900/60 text-slate-100 backdrop-blur-lg';
  const showLeagueBotCleanup = false;
  const isAdmin = user?.role === 'admin';

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
                  <h1 className="text-3xl font-bold">{t('settings.header.title')}</h1>
                  <p className="mt-1 text-sm text-slate-300">{t('settings.header.description')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 shadow-lg">
                <Moon className="h-4 w-4" />
                <span>{t('settings.header.themeLabel', { theme: themeLabel })}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Image className="h-5 w-5 text-emerald-300" />
                  {t('settings.teamIdentity.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-300">{t('settings.teamIdentity.description')}</p>
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
                      <img src={logoPreview} alt={t('settings.teamIdentity.logoAlt')} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-3xl">âš½</span>
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
                            {t('common.saving')}
                          </>
                        ) : (
                          t('settings.teamIdentity.uploadLogo')
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={handleRemoveLogo}
                        disabled={!user || isSavingLogo || !logoPreview}
                        className="text-slate-300 hover:text-emerald-100"
                      >
                        {t('settings.teamIdentity.removeLogo')}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-400">
                      {t('settings.teamIdentity.updatedHint', { teamName: user?.teamName ?? t('settings.teamIdentity.fallbackTeamName') })}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-emerald-300" />
                  {t('settings.club.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-3">
                  <p className="text-sm text-slate-300">{t('settings.club.clubName')}: <span className="font-semibold text-emerald-200">{user?.teamName ?? t('common.teamFallback')}</span></p>
                  <p className="text-xs text-slate-400">{t('settings.club.renameCost', { cost: CLUB_RENAME_COST })}</p>
                  <Button
                    variant="secondary"
                    className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    onClick={() => {
                      setClubNameInput(user?.teamName ?? '');
                      setIsClubRenameOpen(true);
                    }}
                  >
                    {t('settings.club.renameClub')}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-sm text-slate-300">{t('settings.club.stadiumName')}: <span className="font-semibold text-emerald-200">{stadiumName ?? t('settings.club.fallbackStadium')}</span></p>
                  <p className="text-xs text-slate-400">{t('settings.club.renameCost', { cost: STADIUM_RENAME_COST })}</p>
                  <Button
                    variant="outline"
                    className="border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20"
                    onClick={() => {
                      setStadiumNameInput(stadiumName ?? '');
                      setIsStadiumRenameOpen(true);
                    }}
                  >
                    {t('settings.club.renameStadium')}
                  </Button>
                </div>

                <p className="text-xs text-slate-400">{t('settings.club.currentBalance', { balance: formatNumber(balance) })}</p>
              </CardContent>
            </Card>

            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5 text-emerald-300" />
                  {t('settings.contact.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-slate-300">{t('settings.contact.description')}</p>
                <div className="space-y-2">
                  <Label htmlFor="contact-phone" className="text-xs uppercase tracking-wide text-emerald-200/70">
                    {t('settings.contact.phoneLabel')}
                  </Label>
                  <Input
                    id="contact-phone"
                    value={contactPhone}
                    onChange={event => setContactPhone(event.target.value)}
                    placeholder="+90 555 000 00 00"
                    inputMode="tel"
                    disabled={!user || isSavingContact}
                    className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40"
                  />
                  <p className="text-xs text-slate-400">
                    {t('settings.contact.phoneHelp')}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contact-crypto" className="flex items-center gap-2 text-xs uppercase tracking-wide text-emerald-200/70">
                    <Wallet className="h-4 w-4" />
                    {t('settings.contact.cryptoLabel')}
                  </Label>
                  <Input
                    id="contact-crypto"
                    value={contactCrypto}
                    onChange={event => setContactCrypto(event.target.value)}
                    placeholder={t('settings.contact.cryptoPlaceholder')}
                    disabled={!user || isSavingContact}
                    className="border-white/10 bg-slate-950/70 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40"
                  />
                  <p className="text-xs text-slate-400">
                    {t('settings.contact.cryptoHelp')}
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
                    {t('settings.contact.reset')}
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
                        {t('common.saving')}
                      </>
                    ) : (
                      t('settings.contact.save')
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Moon className="h-5 w-5 text-emerald-300" />
                  {t('settings.appearance.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-300">
                  {t('settings.appearance.description')}
                </p>
                <p className="text-xs text-slate-400">{t('settings.appearance.note')}</p>
              </CardContent>
            </Card>

            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Gift className="h-5 w-5 text-emerald-300" />
                  {t('settings.vip.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-xl border border-emerald-300/20 bg-emerald-500/5 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-100">{t('settings.vip.dailyTitle')}</p>
                      <p className="text-sm text-slate-300">
                        {t('settings.vip.dailyDescription')}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {t('settings.vip.lastRewardDate')}{' '}
                        <span className="font-medium text-emerald-200">{lastDailyRewardLabel}</span>
                      </p>
                    </div>
                    <Button
                      onClick={processDailyReward}
                      disabled={!canInteract || hasClaimedToday}
                      variant="outline"
                      className="mt-2 w-full border-emerald-400/40 text-emerald-100 hover:bg-emerald-500/20 sm:mt-0 sm:w-auto"
                    >
                      {hasClaimedToday ? t('settings.vip.claimedToday') : t('settings.vip.checkReward')}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-emerald-300/20 bg-slate-900/60 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Crown className={`h-5 w-5 ${isVipActive ? 'text-amber-300' : 'text-slate-500'}`} />
                        <p className="font-semibold text-slate-100">
                          {t('settings.vip.statusLabel')}{' '}
                          <span className={isVipActive ? 'text-amber-300' : 'text-slate-300'}>
                            {isVipActive ? t('settings.vip.active') : t('settings.vip.inactive')}
                          </span>
                        </p>
                      </div>
                      <div className="text-sm text-slate-300">
                        <p>{t('settings.vip.perkDaily')}</p>
                        <p>{t('settings.vip.perkDuration', { percent: vipDurationPercent })}</p>
                        <p>{t('settings.vip.perkStarCard')}</p>
                      </div>
                      <div className="text-xs text-slate-400">
                        <p>
                          {t('settings.vip.selectedPlan')}{' '}
                          <span className="font-medium text-emerald-200">{vipPlanLabel}</span>
                        </p>
                        <p>
                          {t('settings.vip.expiry')}{' '}
                          <span className="font-medium text-emerald-200">{vipExpiryLabel}</span>
                        </p>
                        <p>
                          {t('settings.vip.lastStarCard')}{' '}
                          <span className="font-medium text-emerald-200">{lastMonthlyStarCardLabel}</span>
                        </p>
                        <p>
                          {t('settings.vip.starCardCredits')}{' '}
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
                          {t('settings.vip.viewPlans')}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={deactivateVip}
                          disabled={!canInteract}
                          className="text-slate-300 hover:text-emerald-100"
                        >
                          {t('settings.vip.disable')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex w-full flex-col gap-2 sm:w-auto">
                        <Button
                          onClick={() => navigate('/store/vip')}
                          disabled={!canInteract}
                          className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                        >
                          {t('settings.vip.viewPlans')}
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
                <CardTitle>{t('settings.notifications.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label className="font-medium">{t('settings.notifications.phoneTitle')}</Label>
                    <p className="text-sm text-slate-400">
                      {t('settings.notifications.phoneDescription')}
                    </p>
                  </div>
                  <Switch
                    checked={pushEnabled}
                    disabled={!user || isSavingPushPreference}
                    onCheckedChange={handlePushToggle}
                  />
                </div>
                <p className="text-xs text-slate-400">{t('settings.notifications.platformNote')}</p>
                {!Capacitor.isNativePlatform() ? (
                  <p className="text-xs text-amber-300">
                    {t('settings.notifications.webNote')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-emerald-300" />
                  {t('settings.performance.title')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">{t('settings.performance.soundEffects')}</Label>
                    <p className="text-sm text-slate-400">{t('settings.performance.soundEffectsDescription')}</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-medium">{t('settings.performance.animations')}</Label>
                    <p className="text-sm text-slate-400">{t('settings.performance.animationsDescription')}</p>
                  </div>
                  <Switch />
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.performance.graphicsQuality')}</Label>
                  <Select defaultValue="high">
                    <SelectTrigger className="border-white/10 bg-slate-950/70 text-slate-100 focus:ring-emerald-500/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
                      <SelectItem value="low">{t('settings.performance.low')}</SelectItem>
                      <SelectItem value="medium">{t('settings.performance.medium')}</SelectItem>
                      <SelectItem value="high">{t('settings.performance.high')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle>{t('settings.locale.title')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('settings.language.label')}</Label>
                  <Select value={language} onValueChange={(value) => setLanguage(value as typeof language)}>
                    <SelectTrigger className="border-white/10 bg-slate-950/70 text-slate-100 focus:ring-emerald-500/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
                      {availableLanguages.map((option) => (
                        <SelectItem key={option.code} value={option.code}>
                          {option.nativeLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400">{t('settings.language.help')}</p>
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.locale.currency')}</Label>
                  <Select defaultValue="try">
                    <SelectTrigger className="border-white/10 bg-slate-950/70 text-slate-100 focus:ring-emerald-500/40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-slate-950 text-slate-100">
                      <SelectItem value="try">TÃ¼rk LirasÄ± (â‚º)</SelectItem>
                      <SelectItem value="eur">Euro (â‚¬)</SelectItem>
                      <SelectItem value="usd">US Dollar ($)</SelectItem>
                      <SelectItem value="gbp">British Pound (Â£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className={cardBaseClass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-emerald-300" />
                  {t('settings.data.title')}
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
                    {t('settings.data.export')}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
                    onClick={handleClearCache}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('settings.data.clearCache')}
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-start border-white/20 bg-white/5 text-slate-100 hover:bg-white/10"
                    onClick={handleOpenAdPrivacyOptions}
                    disabled={isOpeningAdPrivacyOptions}
                  >
                    {isOpeningAdPrivacyOptions ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    {t('settings.data.adPrivacy')}
                  </Button>

                  {showRewardedAdsDebugTools ? (
                    <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
                        Rewarded Ads Debug
                      </p>
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          className="w-full justify-start border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                          onClick={handleRefreshRewardedAdsDebugInfo}
                          disabled={isLoadingRewardedAdsDebugInfo}
                        >
                          {isLoadingRewardedAdsDebugInfo ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Settings className="mr-2 h-4 w-4" />
                          )}
                          {t('settings.data.refreshDebug')}
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full justify-start border-cyan-400/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                          onClick={handleOpenAdInspector}
                          disabled={isOpeningAdInspector}
                        >
                          {isOpeningAdInspector ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="mr-2 h-4 w-4" />
                          )}
                          {t('settings.data.openInspector')}
                        </Button>
                      </div>

                      {rewardedAdsDebugInfo ? (
                        <div className="mt-3 grid gap-2 text-xs text-slate-200 sm:grid-cols-2">
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Version Code</p>
                            <p className="font-medium">{rewardedAdsDebugInfo.versionCode ?? '-'}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Install Source</p>
                            <p className="font-medium">{rewardedAdsDebugInfo.installSource || '-'}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Device</p>
                            <p className="font-medium">
                              {rewardedAdsDebugInfo.deviceModel || '-'} / SDK {rewardedAdsDebugInfo.sdkInt ?? '-'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Network</p>
                            <p className="font-medium">{rewardedAdsDebugInfo.networkType || '-'}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Consent</p>
                            <p className="font-medium">{rewardedAdsDebugInfo.consentStatus || '-'}</p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
                            <p className="text-slate-400">Ad Cache</p>
                            <p className="font-medium">
                              {rewardedAdsDebugInfo.adLoaded ? t('settings.data.ready') : t('settings.data.empty')}
                              {rewardedAdsDebugInfo.adAgeMs != null ? ` / ${Math.round(rewardedAdsDebugInfo.adAgeMs / 1000)} ${t('settings.data.secondsShort')}` : ''}
                            </p>
                          </div>
                          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2 sm:col-span-2">
                            <p className="text-slate-400">Loaded At</p>
                            <p className="font-medium">{formatDebugTimestamp(rewardedAdsDebugInfo.loadedAtMs)}</p>
                          </div>
                          {(rewardedAdsDebugInfo.lastLoadError || rewardedAdsDebugInfo.lastShowError) ? (
                            <div className="rounded-lg border border-amber-400/20 bg-amber-500/5 p-2 text-amber-100 sm:col-span-2">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300">{t('settings.data.lastError')}</p>
                              <p className="mt-1">
                                {rewardedAdsDebugInfo.lastShowError?.message || rewardedAdsDebugInfo.lastLoadError?.message || '-'}
                              </p>
                              <p className="mt-1 text-[11px] text-amber-200/80">
                                Stage: {rewardedAdsDebugInfo.lastShowError?.stage || rewardedAdsDebugInfo.lastLoadError?.stage || '-'}
                                {' â€¢ '}
                                Code: {rewardedAdsDebugInfo.lastShowError?.code ?? rewardedAdsDebugInfo.lastLoadError?.code ?? '-'}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {isAdmin ? (
                    <div className="border-t border-white/10 pt-4">
                      <p className="mb-2 text-xs text-slate-400">{t('settings.data.adminActions')}</p>
                      <Button
                        variant="outline"
                        className="w-full justify-start border-cyan-500/20 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                        onClick={() => navigate('/admin/live-league')}
                      >
                        <Settings className="mr-2 h-4 w-4" />
                        {t('settings.data.liveLeagueOps')}
                      </Button>
                    </div>
                  ) : null}

                  {showLeagueBotCleanup && <div className="pt-4 border-t border-white/10">
                    <p className="mb-2 text-xs text-slate-400">YÃ¶netici Ä°ÅŸlemleri</p>
                    <Button
                      variant="destructive"
                      className="w-full justify-start border-rose-500/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                      onClick={handleCleanLeagues}
                      disabled={isCleaningLeagues}
                    >
                      {isCleaningLeagues ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Lig BotlarÄ±nÄ± Temizle (Kapasite DÃ¼zelt)
                    </Button>
                  </div>}
                </div>

                <div className="border-t border-white/10 pt-4">
                  <div className="space-y-2 text-sm text-slate-300">
                    <div className="flex justify-between">
                      <span>{t('settings.data.gameData')}</span>
                      <span>2.4 MB</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settings.data.cache')}</span>
                      <span>15.8 MB</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{t('settings.data.total')}</span>
                      <span>18.2 MB</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className={cardBaseClass}>
            <CardHeader>
              <CardTitle>{t('settings.about.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-400">{t('settings.about.version')}</span>
                  <span>1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{t('settings.about.lastUpdate')}</span>
                  <span>{aboutLastUpdateLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">{t('settings.about.developer')}</span>
                  <span>Turhan KAYAER</span>
                </div>
              </div>

              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="space-y-2">
                  <Button variant="ghost" className="w-full justify-start text-sm text-slate-200 hover:text-emerald-100">
                    {t('settings.about.privacyPolicy')}
                  </Button>
                  <Button variant="ghost" className="w-full justify-start text-sm text-slate-200 hover:text-emerald-100">
                    {t('settings.about.terms')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-start border-emerald-400/30 bg-emerald-500/10 text-sm text-emerald-100 hover:bg-emerald-500/20"
                    onClick={handleOpenWhatsAppSupport}
                  >
                    <MessageCircle className="mr-2 h-4 w-4" />
                    {t('settings.about.whatsappSupport')}
                  </Button>
                  <p className="text-xs text-slate-400">
                    {t('settings.about.whatsappHelp')}
                    <span className="ml-1 font-medium text-emerald-200">{WHATSAPP_SUPPORT_PHONE}</span>
                  </p>
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
            <DialogTitle>{t('settings.dialogs.clubRenameTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.dialogs.clubRenameDescription', { cost: CLUB_RENAME_COST })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="club-name">{t('settings.dialogs.clubNameLabel')}</Label>
            <Input
              id="club-name"
              value={clubNameInput}
              onChange={event => setClubNameInput(event.target.value)}
              placeholder={user?.teamName ?? t('settings.teamIdentity.fallbackTeamName')}
              maxLength={MAX_RENAME_LENGTH}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setIsClubRenameOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleClubRename} disabled={isRenamingClub}>
              {isRenamingClub ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.confirm')} ({CLUB_RENAME_COST})
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
            <DialogTitle>{t('settings.dialogs.stadiumRenameTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.dialogs.stadiumRenameDescription', { cost: STADIUM_RENAME_COST })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="stadium-name">{t('settings.dialogs.stadiumNameLabel')}</Label>
            <Input
              id="stadium-name"
              value={stadiumNameInput}
              onChange={event => setStadiumNameInput(event.target.value)}
              placeholder={stadiumName ?? t('settings.club.fallbackStadium')}
              maxLength={MAX_RENAME_LENGTH}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setIsStadiumRenameOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleStadiumRename} disabled={isRenamingStadium}>
              {isRenamingStadium ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('common.confirm')} ({STADIUM_RENAME_COST})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}










