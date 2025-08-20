import { Diamond } from 'lucide-react';
import { useDiamonds } from '@/contexts/DiamondContext';

const TopBar = () => {
  const { balance } = useDiamonds();
  return (
    <div className="flex justify-end items-center p-4 border-b">
      <div className="flex items-center gap-1">
        <Diamond className="h-5 w-5 text-blue-500" />
        <span>{balance}</span>
      </div>
    </div>
  );
};

export default TopBar;
