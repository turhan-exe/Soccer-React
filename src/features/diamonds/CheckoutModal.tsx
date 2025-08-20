import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { DiamondPack } from './packs';

interface Props {
  pack: DiamondPack | null;
  onClose: () => void;
}

const CheckoutModal: React.FC<Props> = ({ pack, onClose }) => {
  const { purchase } = useDiamonds();

  const handleConfirm = async () => {
    if (!pack) return;
    await purchase(pack);
    onClose();
  };

  return (
    <Dialog open={!!pack} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kripto ile ödeme</DialogTitle>
        </DialogHeader>
        <p>Cüzdan bağlandı (simülasyon)</p>
        {pack && (
          <div className="mt-4 space-y-1 text-sm">
            <div>Ağ ücreti: ~0.001 ETH</div>
            {pack.priceFiat && <div>Toplam: ₺{pack.priceFiat.toFixed(2)}</div>}
          </div>
        )}
        <DialogFooter>
          <Button onClick={handleConfirm} data-testid="checkout-confirm">
            Ödemeyi Onayla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CheckoutModal;
