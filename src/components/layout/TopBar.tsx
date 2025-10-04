import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BatteryCharging,
  Diamond,
  HeartPulse,
  Loader2,
  Plus,
  Smile,
  type LucideIcon,
} from 'lucide-react';

import AppLogo from '@/components/AppLogo';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDiamonds } from '@/contexts/DiamondContext';
import { useInventory } from '@/contexts/InventoryContext';
import type { KitType } from '@/types';
import { KIT_CONFIG, formatKitEffect } from '@/lib/kits';
import KitUsageDialog from '@/components/kit/KitUsageDialog';
import { toast } from 'sonner';

const KIT_ICONS: Record<KitType, { icon: LucideIcon; color: string }> = {
  energy: { icon: BatteryCharging, color: 'text-emerald-500' },
  morale: { icon: Smile, color: 'text-amber-500' },
  health: { icon: HeartPulse, color: 'text-rose-500' },
};

const TopBar = () => {
  const navigate = useNavigate();
  const { balance } = useDiamonds();
  const { kits, purchaseKit, isProcessing } = useInventory();
  const [activeKit, setActiveKit] = useState<KitType | null>(null);
  const [isUsageOpen, setIsUsageOpen] = useState(false);

  const handlePurchase = async (type: KitType, method: 'ad' | 'diamonds') => {
    try {
      await purchaseKit(type, method);
    } catch (error) {
      // errors are surfaced through toasts inside the provider
      console.warn('[TopBar] purchase kit failed', error);
    }
  };

  const handleUse = (type: KitType) => {
    if ((kits[type] ?? 0) <= 0) {
      toast.error('Stokta yeterli kit bulunmuyor.');
      return;
    }
    setActiveKit(type);
    setIsUsageOpen(true);
  };

  const handleUsageOpenChange = (open: boolean) => {
    setIsUsageOpen(open);
    if (!open) {
      setActiveKit(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-background/60 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex items-center rounded-md border border-transparent p-1 transition hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label="Ana menüye dön"
        >
          <AppLogo size="sm" showText textClassName="hidden md:inline" />
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(KIT_ICONS) as KitType[]).map((type) => {
            const { icon: Icon, color } = KIT_ICONS[type];
            const count = kits[type] ?? 0;
            const config = KIT_CONFIG[type];
            const effectText = formatKitEffect(type);

            return (
              <DropdownMenu key={type}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${color}`} />
                    <span className="text-sm font-medium">{config.label}</span>
                    <Badge variant={count > 0 ? 'secondary' : 'outline'}>{count}</Badge>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
                  <p className="px-2 text-xs text-muted-foreground">{config.description}</p>
                  {effectText && (
                    <p className="px-2 pb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      {effectText}
                    </p>
                  )}
                  <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(type, 'ad')}>
                    Reklam izle (+{config.adReward})
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={isProcessing} onClick={() => handlePurchase(type, 'diamonds')}>
                    {config.diamondCost} Elmas ile SatÄ±n Al
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={count === 0 || isProcessing}
                    onClick={() => handleUse(type)}
                  >
                    {count === 0 ? 'Stok Yok' : 'Kiti Kullan'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        <div className="flex items-center gap-1" data-testid="topbar-diamond-balance">
          <Diamond className="h-5 w-5 text-blue-500" />
          <span>{balance}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/store/diamonds')}
          data-testid="topbar-diamond-plus"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <KitUsageDialog open={isUsageOpen} kitType={activeKit} onOpenChange={handleUsageOpenChange} />
    </div>
  );
};

export default TopBar;

