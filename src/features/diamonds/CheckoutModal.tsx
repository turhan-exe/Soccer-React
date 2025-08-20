import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDiamonds } from '@/contexts/DiamondContext';
import type { DiamondPack } from '@/services/diamonds';

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
        <p>Cüzdan bağlandı (mock)</p>
        <DialogFooter>
          <Button onClick={handleConfirm}>Ödemeyi onayla</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CheckoutModal;
