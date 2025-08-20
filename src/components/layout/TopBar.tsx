import { Diamond, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useDiamonds } from '@/contexts/DiamondContext';

const TopBar = () => {
  const { balance } = useDiamonds();
  const navigate = useNavigate();

  return (
    <div className="flex justify-end items-center p-4 border-b">
      <div className="flex items-center gap-1" data-testid="topbar-diamond-balance">
        <Diamond className="h-5 w-5 text-blue-500" />
        <span>{balance}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="ml-2"
        onClick={() => navigate('/store/diamonds')}
        data-testid="topbar-diamond-plus"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default TopBar;
