import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Diamond } from 'lucide-react';
import type { DiamondPack } from './packs';
import type { PlayBillingProduct } from '@/services/playBilling';

interface Props {
  packs: DiamondPack[];
  onSelect: (pack: DiamondPack) => void;
  productsById: Record<string, PlayBillingProduct>;
  isStoreLoading: boolean;
  storeError: string | null;
}

const PacksGrid: React.FC<Props> = ({
  packs,
  onSelect,
  productsById,
  isStoreLoading,
  storeError,
}) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
    {packs.map((pack) => {
      const product = productsById[pack.productId];
      const isDisabled = isStoreLoading || !!storeError || !product;
      const priceLabel = product?.formattedPrice ?? (pack.priceFiat ? `TRY ${pack.priceFiat.toFixed(2)}` : null);

      return (
        <Card
          key={pack.id}
          data-testid={`diamond-pack-${pack.id}`}
          className="transition-transform hover:scale-[1.02] hover:shadow-md"
        >
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>{pack.label}</span>
              {pack.bestDeal && <span className="text-xs text-green-600">Best Deal</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-2">
            <span className="flex items-center gap-1 text-lg font-bold">
              <Diamond className="h-6 w-6 text-blue-500" />
              {pack.amount}
            </span>
            {priceLabel && <span className="text-sm text-muted-foreground">{priceLabel}</span>}
            {!product && !isStoreLoading && !storeError && (
              <span className="text-xs text-amber-600">Play urunu hazir degil</span>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={isDisabled}
              onClick={() => onSelect(pack)}
              data-testid={`diamond-buy-${pack.id}`}
            >
              {isStoreLoading ? 'Yukleniyor' : 'Google Play ile Satin Al'}
            </Button>
          </CardFooter>
        </Card>
      );
    })}
  </div>
);

export default PacksGrid;
