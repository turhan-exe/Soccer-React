import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import CheckoutModal from './CheckoutModal';
import { DIAMOND_PACKS } from './packs';
import type { DiamondPack } from '@/services/diamonds';

const DiamondsPage = () => {
  const [selected, setSelected] = useState<DiamondPack | null>(null);

  return (
    <div className="p-4 grid gap-4 md:grid-cols-3">
      {DIAMOND_PACKS.map((pack) => (
        <Card key={pack.id}>
          <CardHeader>
            <CardTitle>{pack.label}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span>{pack.amount} elmas</span>
            <span>₺{pack.price.toFixed(2)}</span>
            <Button onClick={() => setSelected(pack)}>Kripto ile öde</Button>
          </CardContent>
        </Card>
      ))}
      <CheckoutModal pack={selected} onClose={() => setSelected(null)} />
    </div>
  );
};

export default DiamondsPage;
