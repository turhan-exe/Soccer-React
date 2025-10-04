import { cn } from '@/lib/utils';

export type AppLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
  textClassName?: string;
};

const SIZE_MAP: Record<NonNullable<AppLogoProps['size']>, string> = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
};

const AppLogo = ({
  size = 'md',
  showText = false,
  className,
  textClassName,
}: AppLogoProps) => {
  const dimensionClasses = SIZE_MAP[size] ?? SIZE_MAP.md;

  return (
    <div className={cn('flex items-center gap-2 select-none', className)}>
      <img
        src="/Logo/Logo.png"
        alt="FHS Futbol Menajerlik logo"
        className={cn('object-contain', dimensionClasses)}
        loading="lazy"
      />
      {showText ? (
        <span className={cn('font-semibold tracking-tight text-foreground', textClassName)}>
          FHS Futbol Menajerlik
        </span>
      ) : null}
    </div>
  );
};

export default AppLogo;
