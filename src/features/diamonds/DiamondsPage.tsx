import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDiamonds } from '@/contexts/DiamondContext';
import { BackButton } from '@/components/ui/back-button';
import CheckoutModal from './CheckoutModal';
import PacksGrid from './PacksGrid';
import { DIAMOND_PACKS, DiamondPack } from './packs';

const DiamondsPage = () => {
  const { user } = useAuth();
  const { balance } = useDiamonds();
  const [selected, setSelected] = useState<DiamondPack | null>(null);

  if (!user) {
    return <div className="p-4 text-center">Giris yapmalisin</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <BackButton fallbackPath="/" />
          <div>
            <h1 className="text-2xl font-bold">Elmas Magazasi</h1>
            <p className="text-muted-foreground">Oyun deneyimini gelistirmek icin elmas satin al.</p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">Bakiyen: {balance} elmas</div>
      </div>
      <PacksGrid packs={DIAMOND_PACKS} onSelect={setSelected} />
      <CheckoutModal pack={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default DiamondsPage;
