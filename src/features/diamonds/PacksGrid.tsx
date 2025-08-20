import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Diamond } from 'lucide-react';
import type { DiamondPack } from './packs';

interface Props {
  packs: DiamondPack[];
  onSelect: (pack: DiamondPack) => void;
}

const PacksGrid: React.FC<Props> = ({ packs, onSelect }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {packs.map((pack) => (
      <Card
        key={pack.id}
        data-testid={`diamond-pack-${pack.id}`}
        className="hover:shadow-md transition-transform hover:scale-105"
      >
        <CardHeader>
          <CardTitle className="flex justify-between items-center">
            <span>{pack.label}</span>
            {pack.bestDeal && <span className="text-xs text-green-600">Best Deal</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          <Diamond className="h-6 w-6 text-blue-500" />
          <span className="text-lg font-bold">{pack.amount}</span>
          {pack.priceFiat && (
            <span className="text-sm text-muted-foreground">₺{pack.priceFiat.toFixed(2)}</span>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={() => onSelect(pack)}
            data-testid={`diamond-buy-${pack.id}`}
          >
            Satın Al
          </Button>
        </CardFooter>
      </Card>
    ))}
  </div>
);

export default PacksGrid;
