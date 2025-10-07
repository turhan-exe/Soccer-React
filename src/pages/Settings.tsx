import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useTheme } from '@/contexts/ThemeContext';
import { Settings, Moon, Volume2, Trash2, Download, Image, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/ui/back-button';
import { useAuth } from '@/contexts/AuthContext';
import { updateTeamLogo } from '@/services/team';

const MAX_LOGO_SIZE = 512 * 1024; // 512KB
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

export default function SettingsPage() {
  const { theme } = useTheme();
  const { user, refreshTeamInfo } = useAuth();
  const [logoPreview, setLogoPreview] = useState<string | null>(user?.teamLogo ?? null);
  const [isSavingLogo, setIsSavingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const acceptedLogoTypes = ACCEPTED_LOGO_TYPES.join(',');

  useEffect(() => {
    setLogoPreview(user?.teamLogo ?? null);
  }, [user?.teamLogo]);

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
  );
}
