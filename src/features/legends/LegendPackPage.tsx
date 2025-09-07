import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Button } from '@/components/ui/button';
import { BackButton } from '@/components/ui/back-button';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';
import { rentLegend } from '@/services/legends';

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
      await spend(PACK_COST);
      const p = drawLegend(LEGEND_PLAYERS);
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
      toast.success(`${player.name} kiralandı`);
    } catch (err) {
      console.warn(err);
      toast.error('İşlem başarısız');
    }
    setCurrent(null);
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
      <Button onClick={handleOpen} disabled={balance < PACK_COST}>
        Paket Aç (1💎)
      </Button>
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
