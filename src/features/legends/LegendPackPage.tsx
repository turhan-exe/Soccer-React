import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import InfoPopupButton from '@/components/ui/info-popup-button';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';
import { getLegendIdFromPlayer, getRentedLegends, rentLegend } from '@/services/legends';
import { getTeam } from '@/services/team';
import type { Player } from '@/types';
import './legend-pack.css';

const PACK_COST = 250;
const RENT_DURATION_DAYS = 30;
const RENT_DURATION_MS = 1000 * 60 * 60 * 24 * RENT_DURATION_DAYS;
const TOTAL_LEGENDS = LEGEND_PLAYERS.length;
const STORAGE_KEY_PREFIX = 'legend-pack-current';

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}:${userId}`;

interface RentedLegend extends LegendPlayer {
  playerId: string;
  expiresAt: Date;
}

const LegendPackPage = () => {
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const { vipNostalgiaFreeAvailable, consumeVipNostalgiaReward } = useInventory();
  const [current, setCurrent] = useState<LegendPlayer | null>(null);
  const [isDialogOpen, setDialogOpen] = useState(false);
  const [rented, setRented] = useState<RentedLegend[]>([]);
  const [ownedLegendIds, setOwnedLegendIds] = useState<number[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);

  const legendById = useMemo(() => {
    const map = new Map<number, LegendPlayer>();
    LEGEND_PLAYERS.forEach(legend => {
      map.set(legend.id, legend);
    });
    return map;
  }, []);

  useEffect(() => {
    let isActive = true;

    const resetState = () => {
      if (isActive) {
        setOwnedLegendIds([]);
        setRented([]);
        setCurrent(null);
      }
    };

    if (!user) {
      resetState();
      setIsLoadingTeam(false);
      return () => {
        isActive = false;
      };
    }

    setIsLoadingTeam(true);
    setRented([]);
    setCurrent(null);

    const loadData = async () => {
      try {
        const [team, rentals] = await Promise.all([
          getTeam(user.id),
          getRentedLegends(user.id),
        ]);
        if (!isActive) return;
        if (!team?.players) {
          setOwnedLegendIds([]);
        } else {
          const legendIds = extractLegendIds(team.players);
          setOwnedLegendIds(legendIds);
        }

        const normalizedRentals = rentals
          .map(({ legendId, playerId, expiresAt }) => {
            const legend = legendById.get(legendId);
            if (!legend) {
              return null;
            }
            return { ...legend, expiresAt, playerId } as RentedLegend;
          })
          .filter((value): value is RentedLegend => Boolean(value))
          .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
        setRented(normalizedRentals);
      } catch (err) {
        console.warn(err);
      } finally {
        if (isActive) {
          setIsLoadingTeam(false);
        }
      }
    };

    loadData();

    return () => {
      isActive = false;
    };
  }, [legendById, user]);

  const ownedLegendSet = useMemo(() => new Set(ownedLegendIds), [ownedLegendIds]);

  useEffect(() => {
    if (current) {
      setDialogOpen(true);
    } else {
      setDialogOpen(false);
    }
  }, [current]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return;
    }

    const key = getStorageKey(user.id);
    const storedId = window.localStorage.getItem(key);
    if (!storedId) {
      return;
    }

    const legendId = Number.parseInt(storedId, 10);
    if (Number.isNaN(legendId) || ownedLegendSet.has(legendId)) {
      window.localStorage.removeItem(key);
      return;
    }

    const legend = legendById.get(legendId);
    if (!legend) {
      window.localStorage.removeItem(key);
      return;
    }

    setCurrent((prev) => (prev?.id === legend.id ? prev : legend));
  }, [legendById, ownedLegendSet, user]);

  useEffect(() => {
    if (!user || typeof window === 'undefined') {
      return;
    }

    const key = getStorageKey(user.id);
    if (current) {
      window.localStorage.setItem(key, String(current.id));
    } else {
      window.localStorage.removeItem(key);
    }
  }, [current, user]);

  const allCollected = useMemo(
    () => LEGEND_PLAYERS.every((legend) => ownedLegendSet.has(legend.id)),
    [ownedLegendSet],
  );

  const ownedCount = ownedLegendIds.length;

  const handleOpen = async () => {
    if (!user) {
      toast.error('Giris yapmalisin');
      return;
    }
    if (current) {
      toast.info('Önce mevcut kartın için karar vermelisin');
      return;
    }

    const isFree = Boolean(vipNostalgiaFreeAvailable);
    if (!isFree && balance < PACK_COST) {
      toast.error('Yeterli elmas yok');
      return;
    }

    try {
      const availableLegends = LEGEND_PLAYERS.filter(
        (legend) => !ownedLegendSet.has(legend.id),
      );

      if (availableLegends.length === 0) {
        toast.info('Tüm nostalji oyuncularını topladın');
        return;
      }

      if (!isFree) {
        await spend(PACK_COST);
      }

      const p = drawLegend(availableLegends);
      setCurrent(p);

      if (isFree) {
        consumeVipNostalgiaReward();
        toast.success('VIP nostalji paketi ucretsiz acildi.');
      }
    } catch (err) {
      console.warn(err);
      toast.error('Islem basarisiz');
    }
  };

  const handleRent = async (legend: LegendPlayer) => {
    if (!user) return;
    const expiresAt = new Date(Date.now() + RENT_DURATION_MS);
    try {
      const rentedPlayer = await rentLegend(user.id, legend, expiresAt);
      setRented(prev => {
        const next = [...prev, { ...legend, playerId: rentedPlayer.id, expiresAt }];
        return next.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      });
      setOwnedLegendIds((prev) =>
        prev.includes(legend.id) ? prev : [...prev, legend.id].sort((a, b) => a - b),
      );
      toast.success(`${legend.name} ${RENT_DURATION_DAYS} günlüğüne kadrona katıldı`);
      setCurrent(null);
    } catch (err) {
      console.warn(err);
      const message = err instanceof Error ? err.message : 'İşlem başarısız';
      toast.error(message);
    }
  };

  const handleRelease = () => {
    toast.message('Kart serbest bırakıldı');
    setCurrent(null);
  };

  return (
    <div className="legend-pack-page">
      <div className="legend-pack-gradient" aria-hidden />
      <div className="legend-pack-orb legend-pack-orb--left" aria-hidden />
      <div className="legend-pack-orb legend-pack-orb--right" aria-hidden />
      <div className="legend-pack-noise" aria-hidden />

      <div className="legend-pack-shell">
        <header className="legend-pack-header">
          <div className="legend-pack-header-main">
            <BackButton />
            <div>
              <p className="legend-pack-title">Nostalji Paketi</p>
              <p className="legend-pack-subtitle">
                80'ler ve 90'ların efsanelerini kulübüne yeniden kazandır. Paketi aç, rastgele bir ikon 30 günlüğüne kadrona
                katılsın. Nostalji oyuncuları transfer pazarında satılamaz ve sözleşmeleri uzatılamaz.
              </p>
            </div>
          </div>
          <div className="legend-pack-balance">
            <label>Elmas</label>
            <strong>{balance}</strong>
          </div>
        </header>

        <main className="legend-pack-main">
          <section className="legend-pack-panel">
            <h2>Yeni bir efsane keşfet</h2>
            <p>
              Her paket açılışında henüz sahip olmadığın bir efsaneyi kadrona kiralayabilir ve 30 gün boyunca mücadeleye
              sokabilirsin. Süre sonunda efsane otomatik olarak kulübünden ayrılır.
            </p>
            <div className="legend-pack-metrics">
              <div className="legend-pack-metric">
                <span>Toplanan kart</span>
                <strong>
                  {ownedCount}/{TOTAL_LEGENDS}
                </strong>
              </div>
              <div className="legend-pack-metric">
                <span>Kira süresi</span>
                <strong>{RENT_DURATION_DAYS} gün</strong>
              </div>
            </div>
            {vipNostalgiaFreeAvailable ? (
              <p className="mb-3 text-sm font-semibold text-emerald-200">
                VIP uyeligin sayesinde bu paketi bir kez ucretsiz acabilirsin.
              </p>
            ) : null}
            <Button
              size="lg"
              className="w-full"
              onClick={handleOpen}
              disabled={
                (!vipNostalgiaFreeAvailable && balance < PACK_COST) || allCollected || isLoadingTeam || Boolean(current)
              }
            >
              {vipNostalgiaFreeAvailable ? 'Paket Ac (Ucretsiz)' : `Paket Ac (${PACK_COST} Elmas)`}
            </Button>
            {isLoadingTeam ? (
              <p className="text-sm text-slate-300/80">Takım bilgileri yükleniyor...</p>
            ) : current ? (
              <div className="flex flex-col gap-2 text-sm text-amber-200">
                <span>
                  Çektiğin kart seni bekliyor. Kabul etmeden veya serbest bırakmadan yeni paket
                  açamazsın.
                </span>
                {!isDialogOpen ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit border-amber-300/40 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
                    onClick={() => setDialogOpen(true)}
                  >
                    Kartı Göster
                  </Button>
                ) : null}
              </div>
            ) : allCollected ? (
              <p className="text-sm text-emerald-200">Tüm nostalji efsanelerine sahipsin!</p>
            ) : (
              <p className="text-sm text-slate-300/80">
                Eksik kartlarını tamamlamak için paket açmaya devam et.
              </p>
            )}
          </section>
        </main>

        <section className="legend-pack-rented">
          <header>
            <p className="legend-pack-rented-title">Kiralanan efsaneler</p>
            <span className="legend-pack-rented-count">{rented.length} aktif</span>
          </header>
          {rented.length > 0 ? (
            <div className="legend-pack-rented-list">
              {rented.map((p) => (
                <div key={p.id} className="legend-pack-rented-item">
                  <strong>{p.name}</strong>
                  <span>Bitiş tarihi</span>
                  <time>{p.expiresAt.toLocaleDateString()}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="legend-pack-empty flex justify-center">
              <InfoPopupButton
                title="Kiralanan Efsaneler"
                triggerLabel="Kiralanan efsaneler bilgisi"
                triggerClassName="h-10 w-10 rounded-2xl border-white/20 bg-transparent text-cyan-200 hover:border-cyan-300"
                contentClassName="bg-slate-950/95"
                message="Şu anda kiralanmış efsane oyuncun yok. Paketi açarak kadronu güçlendirebilirsin."
              />
            </div>
          )}
        </section>
      </div>

      <Dialog open={Boolean(current) && isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="legend-pack-dialog">
          {current ? <LegendCard player={current} onRent={handleRent} onRelease={handleRelease} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LegendPackPage;

function extractLegendIds(players: Player[]): number[] {
  const ids = new Set<number>();
  players.forEach((player) => {
    const legendId = getLegendIdFromPlayer(player);
    if (typeof legendId === 'number') {
      ids.add(legendId);
    }
  });
  return Array.from(ids).sort((a, b) => a - b);
}



