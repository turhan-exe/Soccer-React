import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { PlayBillingProduct } from '@/services/playBilling';
import type { DiamondPack } from './packs';

interface Props {
  pack: DiamondPack | null;
  storeProduct: PlayBillingProduct | null;
  storeError: string | null;
  isStoreLoading: boolean;
  onClose: () => void;
}

const CheckoutModal: React.FC<Props> = ({
  pack,
  storeProduct,
  storeError,
  isStoreLoading,
  onClose,
}) => {
  const { purchase } = useDiamonds();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const confirmDisabled = useMemo(() => {
    if (!pack) return true;
    if (isSubmitting || isStoreLoading) return true;
    if (storeError) return true;
    return !storeProduct;
  }, [isStoreLoading, isSubmitting, pack, storeError, storeProduct]);

  const handleConfirm = async () => {
    if (!pack || confirmDisabled) return;

    setIsSubmitting(true);
    try {
      await purchase(pack);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={!!pack} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google Play ile odeme</DialogTitle>
        </DialogHeader>

        {pack && (
          <div className="space-y-3 text-sm">
            <p>{pack.amount} elmas Google Play satin alma akisi ile hesaba eklenecek.</p>
            <div className="space-y-1 rounded-lg bg-muted/40 p-3">
              <div>Paket: {pack.label}</div>
              <div>Urun ID: {pack.productId}</div>
              <div>Fiyat: {storeProduct?.formattedPrice ?? `TRY ${pack.priceFiat?.toFixed(2) ?? '-'}`}</div>
            </div>
            {storeError && <p className="text-amber-600">{storeError}</p>}
            {!storeError && !storeProduct && !isStoreLoading && (
              <p className="text-amber-600">Bu paket icin Play Console urunu bulunamadi.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button disabled={confirmDisabled} onClick={handleConfirm} data-testid="checkout-confirm">
            {isSubmitting ? 'Isleniyor' : 'Google Play satin alimini baslat'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CheckoutModal;
