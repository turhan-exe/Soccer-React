import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';
import { getLegendIdFromPlayer, rentLegend } from '@/services/legends';
import { getTeam } from '@/services/team';
import type { Player } from '@/types';

const PACK_COST = 1;
const LEAGUE_DURATION_MS = 1000 * 60 * 60 * 24 * 90;

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

    const loadTeam = async () => {
      try {
        const team = await getTeam(user.id);
        if (!isActive) return;
        if (!team?.players) {
          setOwnedLegendIds([]);
          return;
        }
        const legendIds = extractLegendIds(team.players);
        setOwnedLegendIds(legendIds);
      } catch (err) {
        console.warn(err);
      } finally {
        if (isActive) {
          setIsLoadingTeam(false);
        }
      }
    };

    loadTeam();

    return () => {
      isActive = false;
    };
  }, [user]);

  const ownedLegendSet = useMemo(() => new Set(ownedLegendIds), [ownedLegendIds]);
  const allCollected = useMemo(
    () => LEGEND_PLAYERS.every((legend) => ownedLegendSet.has(legend.id)),
    [ownedLegendSet],
  );

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
      setRented((prev) => [...prev, { ...player, expiresAt }]);
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
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BackButton />
        <h1 className="text-2xl font-bold">Nostalji Paket</h1>
      </div>
      <div>Elmas: {balance}</div>
      <Button
        onClick={handleOpen}
        disabled={balance < PACK_COST || allCollected || isLoadingTeam}
      >
        Paket Aç (1💎)
      </Button>
      {isLoadingTeam && (
        <p className="text-sm text-muted-foreground">Takım bilgileri yükleniyor...</p>
      )}
      {allCollected && (
        <p className="text-sm text-muted-foreground">
          Tüm nostalji efsanelerine sahipsin!
        </p>
      )}
      {current && (
        <LegendCard
          player={current}
          onRent={handleRent}
          onRelease={handleRelease}
        />
      )}
      {rented.length > 0 && (
        <div className="pt-4">
          <h2 className="text-xl font-semibold">Kiralanan Oyuncular</h2>
          <ul className="list-disc list-inside">
            {rented.map((p) => (
              <li key={p.id}>
                {p.name} - Sözleşme bitiş:{' '}
                {p.expiresAt.toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}
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
