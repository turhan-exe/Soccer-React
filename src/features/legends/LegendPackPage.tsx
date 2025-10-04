import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';
import { getLegendIdFromPlayer, getRentedLegends, rentLegend } from '@/services/legends';
import { getTeam } from '@/services/team';
import type { Player } from '@/types';
import './legend-pack.css';

const PACK_COST = 1;
const LEAGUE_DURATION_MS = 1000 * 60 * 60 * 24 * 90;
const TOTAL_LEGENDS = LEGEND_PLAYERS.length;

interface RentedLegend extends LegendPlayer {
  expiresAt: Date;
}

const LegendPackPage = () => {
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const [current, setCurrent] = useState<LegendPlayer | null>(null);
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
          .map(({ legendId, expiresAt }) => {
            const legend = legendById.get(legendId);
            if (!legend) {
              return null;
            }
            return { ...legend, expiresAt } as RentedLegend;
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
  const allCollected = useMemo(
    () => LEGEND_PLAYERS.every((legend) => ownedLegendSet.has(legend.id)),
    [ownedLegendSet],
  );

  const ownedCount = ownedLegendIds.length;

  const handleOpen = async () => {
    if (!user) {
      toast.error('Giriş yapmalısın');
      return;
    }
    if (balance < PACK_COST) {
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

      await spend(PACK_COST);
      const p = drawLegend(availableLegends);
      setCurrent(p);
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
  };

  const handleRent = async (player: LegendPlayer) => {
    if (!user) return;
    const expiresAt = new Date(Date.now() + LEAGUE_DURATION_MS);
    try {
      await rentLegend(user.id, player, expiresAt);
      setRented(prev => {
        const next = [...prev, { ...player, expiresAt }];
        return next.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
      });
      setOwnedLegendIds((prev) =>
        prev.includes(player.id) ? prev : [...prev, player.id].sort((a, b) => a - b),
      );
      toast.success(`${player.name} kiralandı`);
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
                80'ler ve 90'ların efsanelerini kulübüne yeniden kazandır. Paketi aç, rastgele bir
                ikon kadrona katılsın.
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
              Her paket açılışında henüz sahip olmadığın bir efsaneyi kadrona kiralayabilir ve 90
              gün boyunca şampiyonluk mücadelesinde kullanabilirsin.
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
                <strong>90 gün</strong>
              </div>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={handleOpen}
              disabled={balance < PACK_COST || allCollected || isLoadingTeam}
            >
              Paket Aç (1 Elmas)
            </Button>
            {isLoadingTeam ? (
              <p className="text-sm text-slate-300/80">Takım bilgileri yükleniyor...</p>
            ) : allCollected ? (
              <p className="text-sm text-emerald-200">Tüm nostalji efsanelerine sahipsin!</p>
            ) : (
              <p className="text-sm text-slate-300/80">
                Eksik kartlarını tamamlamak için paket açmaya devam et.
              </p>
            )}
          </section>

          <section className="legend-pack-card-slot">
            {current ? (
              <LegendCard player={current} onRent={handleRent} onRelease={handleRelease} />
            ) : (
              <div className="legend-pack-placeholder">
                Yeni bir efsane için paketi aç ve kartı kulübüne kat.
              </div>
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
            <p className="legend-pack-empty">
              Şu anda kiralanmış efsane oyuncun yok. Paketi açarak kadronu güçlendirebilirsin.
            </p>
          )}
        </section>
      </div>
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
