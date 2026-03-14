import { cn } from '@/lib/utils';

const DEFAULT_GAUGE_FALLBACK = 0.75;

export type PerformanceGaugeVariant = 'light' | 'dark';

export interface PerformanceGaugeProps {
  label: string;
  value: number;
  variant?: PerformanceGaugeVariant;
  className?: string;
}

export function clampPerformanceGauge(value?: number | null, fallback = DEFAULT_GAUGE_FALLBACK): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return fallback;
}

export function performanceGaugeColor(value: number): string {
  const normalized = clampPerformanceGauge(value);
  if (normalized >= 0.9) return 'bg-emerald-500';
  if (normalized >= 0.75) return 'bg-lime-500';
  if (normalized >= 0.6) return 'bg-amber-500';
  return 'bg-red-500';
}

export function PerformanceGauge({
  label,
  value,
  variant = 'light',
  className,
}: PerformanceGaugeProps) {
  const normalized = clampPerformanceGauge(value);
  const percent = Math.round(normalized * 100);
  const textClass = variant === 'dark' ? 'text-white/70' : 'text-muted-foreground';
  const valueClass = variant === 'dark' ? 'text-white font-semibold' : 'text-foreground font-semibold';
  const trackClass = variant === 'dark' ? 'bg-white/20' : 'bg-muted';

  return (
    <div className={cn('space-y-1', className)}>
      <div className={cn('flex items-center justify-between text-xs', textClass)}>
        <span>{label}</span>
        <span className={valueClass}>{percent}</span>
      </div>
      <div className={cn('h-2 rounded-full overflow-hidden', trackClass)}>
        <div
          className={cn('h-full rounded-full transition-all', performanceGaugeColor(normalized))}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
