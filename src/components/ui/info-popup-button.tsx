import { AlertCircle } from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface InfoPopupButtonProps {
  message: React.ReactNode;
  title?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

const InfoPopupButton: React.FC<InfoPopupButtonProps> = ({
  message,
  title = 'Bilgi',
  triggerLabel = 'Bilgi mesajını görüntüle',
  triggerClassName,
  contentClassName,
}) => {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/60 focus:ring-offset-2 focus:ring-offset-slate-950',
            triggerClassName,
          )}
        >
          <AlertCircle className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'max-w-sm border border-white/10 bg-slate-950/95 text-left text-slate-100 shadow-2xl backdrop-blur',
          contentClassName,
        )}
      >
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-lg font-semibold text-white">{title}</DialogTitle>
          <DialogDescription className="text-sm text-slate-300">
            {message}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
};

export default InfoPopupButton;
