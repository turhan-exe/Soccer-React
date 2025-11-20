import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getTeam, updateTeamAssets } from '@/services/team';
import { type ClubTeam, type TeamBadge, type TeamKitAssets } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { storage } from '@/services/firebase';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

type LabeledInputProps = React.ComponentProps<typeof Input> & { label?: string };
const LabeledInput = ({ label, className, ...props }: LabeledInputProps) => (
  <label className="space-y-1 text-sm">
    {label ? <span className="block text-xs font-semibold text-muted-foreground">{label}</span> : null}
    <Input className={className} {...props} />
  </label>
);

type KitKey = 'home' | 'away' | 'third';
type KitField = 'textureUrl' | 'normalMapUrl' | 'contentType' | 'width' | 'height';

type KitEditable = NonNullable<TeamKitAssets>[KitKey];

const toNumberString = (value?: number | null) => (Number.isFinite(value ?? NaN) ? String(value) : '');
const parseNumber = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export default function TeamAssetsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState<ClubTeam | null>(null);
  const [badge, setBadge] = useState<TeamBadge | undefined>(undefined);
  const [kit, setKit] = useState<TeamKitAssets | undefined>(undefined);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    setLoading(true);
    getTeam(user.id)
      .then((t) => {
        if (!mounted || !t) return;
        setTeam(t);
        setBadge(t.badge ?? (t.logo ? { url: t.logo, alt: `${t.name} logo` } : undefined));
        setKit(t.kit ?? undefined);
      })
      .catch(() => {
        if (mounted) toast.error('Takım verisi alınamadı.');
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [user]);

  const handleBadgeChange = (field: keyof TeamBadge, value: string) => {
    setBadge((prev) => {
      const next: TeamBadge = { ...(prev ?? {}), url: prev?.url ?? '' };
      if (field === 'width' || field === 'height') {
        const parsed = parseNumber(value);
        if (parsed === undefined) {
          delete (next as any)[field];
        } else {
          (next as any)[field] = parsed;
        }
      } else {
        (next as any)[field] = value;
      }
      return next;
    });
  };

  const handleKitChange = (kitKey: KitKey, field: KitField, value: string) => {
    setKit((prev) => {
      const next: TeamKitAssets = { ...(prev ?? {}) };
      const current: KitEditable = { ...(next[kitKey] ?? {}) };
      if (field === 'width' || field === 'height') {
        const parsed = parseNumber(value);
        if (parsed === undefined) {
          delete (current as any)[field];
        } else {
          (current as any)[field] = parsed;
        }
      } else {
        if (value) {
          (current as any)[field] = value;
        } else {
          delete (current as any)[field];
        }
      }
      next[kitKey] = current;
      return next;
    });
  };

  const kitDefaults = useMemo(() => ['home', 'away', 'third'] as KitKey[], []);

  const handleUpload = async (file: File, target: 'badge' | KitKey, kind: 'texture' | 'normal') => {
    if (!user) {
      toast.error('Önce giriş yapmalısın.');
      return;
    }
    const path = `team-assets/${user.id}/${target}-${kind}-${Date.now()}.${(file.name.split('.').pop() || 'png')}`;
    setUploadingKey(`${target}-${kind}`);
    try {
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const url = await getDownloadURL(storageRef);

      if (target === 'badge') {
        handleBadgeChange('url', url);
        handleBadgeChange('contentType', file.type || 'image/png');
      } else {
        const field: KitField = kind === 'texture' ? 'textureUrl' : 'normalMapUrl';
        handleKitChange(target, field, url);
        handleKitChange(target, 'contentType', file.type || 'image/png');
      }
      toast.success('Yüklendi');
    } catch (err) {
      console.error(err);
      toast.error('Yükleme başarısız');
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSave = async () => {
    if (!user) {
      toast.error('Önce giriş yapmalısın.');
      return;
    }
    const isBad = (url?: string | null) => {
      if (!url) return false;
      const lower = url.toLowerCase();
      return lower.startsWith('data:') || lower.endsWith('.svg');
    };

    if (!badge?.url) {
      toast.error('Logo (badge) URL zorunlu.');
      return;
    }
    if (isBad(badge.url)) {
      toast.error('SVG veya data: URL kullanma. PNG/JPEG olarak yükle ve URL gir.');
      return;
    }
    if (!kit?.home?.textureUrl || !kit?.away?.textureUrl) {
      toast.error('Home ve Away kit texture URL zorunlu.');
      return;
    }
    if (isBad(kit.home.textureUrl) || isBad(kit.away.textureUrl)) {
      toast.error('Kit texture için SVG veya data: URL kullanma. PNG/JPEG yükle.');
      return;
    }

    setSaving(true);
    try {
      await updateTeamAssets(user.id, { badge, kit });
      toast.success('Görsel veriler kaydedildi.');
    } catch (error) {
      console.error(error);
      toast.error('Kaydetme başarısız.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Logo ve Forma Varlıkları</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Unity TeamSelection için badge (logo) ile home/away/third kit texture URL’lerini burada saklayabilirsin.
            Badge URL ve home/away texture URL alanları zorunludur. PNG tavsiye edilir.
          </p>

          <div className="space-y-2">
            <div className="text-sm font-semibold">Badge / Logo</div>
            <div className="grid gap-3 md:grid-cols-2">
              <LabeledInput
                label="Badge URL*"
                placeholder="https://cdn.example.com/badges/team.png"
                value={badge?.url ?? ''}
                disabled={loading || saving}
                onChange={(e) => handleBadgeChange('url', e.target.value)}
              />
              <LabeledInput
                label="Alt Yazı"
                placeholder="Takım logosu"
                value={badge?.alt ?? ''}
                disabled={loading || saving}
                onChange={(e) => handleBadgeChange('alt', e.target.value)}
              />
              <LabeledInput
                label="İçerik Tipi"
                placeholder="image/png"
                value={badge?.contentType ?? 'image/png'}
                disabled={loading || saving}
                onChange={(e) => handleBadgeChange('contentType', e.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <LabeledInput
                  label="Genişlik (px)"
                  type="number"
                  placeholder="256"
                  value={toNumberString(badge?.width)}
                  disabled={loading || saving}
                  onChange={(e) => handleBadgeChange('width', e.target.value)}
                />
                <LabeledInput
                  label="Yükseklik (px)"
                  type="number"
                  placeholder="256"
                  value={toNumberString(badge?.height)}
                  disabled={loading || saving}
                  onChange={(e) => handleBadgeChange('height', e.target.value)}
                />
              </div>
              <div className="md:col-span-2 space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Dosyadan Yükle</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={loading || saving || uploadingKey === 'badge-texture'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file, 'badge', 'texture');
                  }}
                />
                <p className="text-[11px] text-muted-foreground">
                  Dosya Firebase Storage’a yüklenir, URL ve içerik tipi otomatik dolar. PNG önerilir.
                </p>
              </div>
            </div>
          </div>

          {kitDefaults.map((key) => {
            const data = kit?.[key];
            return (
              <div key={key} className="space-y-2 rounded-lg border p-4">
                <div className="text-sm font-semibold capitalize">
                  {key === 'home' ? 'Home' : key === 'away' ? 'Away' : 'Third'} Kit
                  {key !== 'third' ? ' *' : ''}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <LabeledInput
                    label="Texture URL"
                    placeholder={`https://cdn.example.com/kits/${key}.png`}
                    value={data?.textureUrl ?? ''}
                    disabled={loading || saving}
                    onChange={(e) => handleKitChange(key, 'textureUrl', e.target.value)}
                  />
                  <LabeledInput
                    label="Normal Map URL"
                    placeholder={`https://cdn.example.com/kits/${key}-norm.png`}
                    value={data?.normalMapUrl ?? ''}
                    disabled={loading || saving}
                    onChange={(e) => handleKitChange(key, 'normalMapUrl', e.target.value)}
                  />
                  <LabeledInput
                    label="İçerik Tipi"
                    placeholder="image/png"
                    value={data?.contentType ?? 'image/png'}
                    disabled={loading || saving}
                    onChange={(e) => handleKitChange(key, 'contentType', e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <LabeledInput
                      label="Genişlik (px)"
                      type="number"
                      placeholder="1024"
                      value={toNumberString(data?.width)}
                      disabled={loading || saving}
                      onChange={(e) => handleKitChange(key, 'width', e.target.value)}
                    />
                    <LabeledInput
                      label="Yükseklik (px)"
                      type="number"
                      placeholder="1024"
                      value={toNumberString(data?.height)}
                      disabled={loading || saving}
                      onChange={(e) => handleKitChange(key, 'height', e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2 grid gap-2 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">Texture’u Dosyadan Yükle</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={loading || saving || uploadingKey === `${key}-texture`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(file, key, 'texture');
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-muted-foreground">Normal Map Yükle</label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={loading || saving || uploadingKey === `${key}-normal`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUpload(file, key, 'normal');
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground md:col-span-2">
                      Dosya Storage’a yüklenir; URL ve içerik tipi otomatik doldurulur.
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={loading || saving}>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
