import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import CheckoutModal from './CheckoutModal';
import PacksGrid from './PacksGrid';
import { DIAMOND_PACKS, DiamondPack } from './packs';

const DiamondsPage = () => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<DiamondPack | null>(null);

  if (!user) {
    return <div className="p-4 text-center">Giriş yapmalısın</div>;
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Elmas Mağazası</h1>
        <p className="text-muted-foreground">Oyun deneyimini geliştirmek için elmas satın al.</p>
      </div>
      <PacksGrid packs={DIAMOND_PACKS} onSelect={setSelected} />
      <CheckoutModal pack={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default DiamondsPage;
