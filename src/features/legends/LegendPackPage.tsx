import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import LegendCard from './LegendCard';
import { LEGEND_PLAYERS, type LegendPlayer } from './players';
import { drawLegend } from './drawLegend';

const PACK_COST = 1;

const LegendPackPage = () => {
  const { user } = useAuth();
  const { balance, spend } = useDiamonds();
  const [current, setCurrent] = useState<LegendPlayer | null>(null);

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

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Nostalji Paket</h1>
      <div>Elmas: {balance}</div>
      <Button onClick={handleOpen} disabled={balance < PACK_COST}>
        Paket Aç (1💎)
      </Button>
      {current && <LegendCard player={current} />}
    </div>
  );
};

export default LegendPackPage;
