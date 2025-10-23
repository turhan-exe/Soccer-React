import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import type { Player } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { MetricKey } from './useTeamPlanningStore';

const BASE_PITCH_WIDTH = 680;
const BASE_PITCH_HEIGHT = 1050;
const PITCH_MARKER_RADIUS = 26;
const PITCH_MARKER_CIRCUMFERENCE = 2 * Math.PI * PITCH_MARKER_RADIUS;

export type PitchSlot = {
  slotIndex: number;
  position: Player['position'];
  x: number;
  y: number;
  player: Player | null;
};

type PitchProps = {
  slots: PitchSlot[];
  onPitchDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onPositionDrop: (event: React.DragEvent<HTMLDivElement>, slot: PitchSlot) => void;
  onPlayerDragStart: (player: Player, event: React.DragEvent<HTMLDivElement>) => void;
  onPlayerDragEnd: (player: Player, event: React.DragEvent<HTMLDivElement>) => void;
  onSelectPlayer: (playerId: string) => void;
  focusedPlayerId: string | null;
  selectedMetric: MetricKey;
  getMetricValue: (player: Player, metric: MetricKey) => number;
  renderTooltip: (player: Player) => React.ReactNode;
};

type PitchPlayerMarkerProps = {
  player: Player;
  value: number;
  metric: MetricKey;
  isFocused: boolean;
  onSelect: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: (event: React.DragEvent<HTMLDivElement>) => void;
};

const formatMetricValue = (metric: MetricKey, value: number): string => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (metric === 'power') {
    return Math.round(value).toString();
  }
  return Math.round(value).toString();
};

const PitchPlayerMarker: React.FC<PitchPlayerMarkerProps> = ({
  player,
  value,
  metric,
  isFocused,
  onSelect,
  onDragStart,
  onDragEnd,
}) => {
  const normalizedValue = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const dashOffset = PITCH_MARKER_CIRCUMFERENCE * (1 - normalizedValue / 100);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        'relative flex h-16 w-16 cursor-grab flex-col items-center justify-center rounded-full border border-white/20 bg-emerald-900/70 px-1.5 py-2 text-center text-white shadow-lg transition-colors duration-150 ease-out',
        isFocused ? 'border-white/60 ring-2 ring-white/80' : 'hover:border-white/40 hover:bg-emerald-800/80',
      )}
    >
      <svg viewBox="0 0 60 60" className="pointer-events-none absolute inset-0 h-full w-full text-emerald-300/70">
        <circle
          cx="30"
          cy="30"
          r={PITCH_MARKER_RADIUS}
          stroke="currentColor"
          strokeWidth="2"
          strokeOpacity="0.15"
          fill="none"
        />
        <circle
          cx="30"
          cy="30"
          r={PITCH_MARKER_RADIUS}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={`${PITCH_MARKER_CIRCUMFERENCE} ${PITCH_MARKER_CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          fill="none"
          className="transition-[stroke-dashoffset] duration-200 ease-out"
        />
      </svg>
      <span className="relative z-10 block max-h-[2.6rem] w-full overflow-hidden text-ellipsis text-[11px] font-semibold leading-tight">
        {player.name}
      </span>
      <div className="relative z-10 mt-1 flex items-center justify-center">
        <span className="rounded-full bg-emerald-900/95 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-50 shadow-sm">
          {formatMetricValue(metric, normalizedValue)}
        </span>
      </div>
    </div>
  );
};

const mergeRefs = <T extends HTMLElement>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> => {
  return value => {
    refs.forEach(ref => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(value);
      } else {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    });
  };
};

const Pitch = forwardRef<HTMLDivElement, PitchProps>((props, forwardedRef) => {
  const {
    slots,
    onPitchDrop,
    onPositionDrop,
    onPlayerDragStart,
    onPlayerDragEnd,
    onSelectPlayer,
    focusedPlayerId,
    selectedMetric,
    getMetricValue,
    renderTooltip,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) {
        return;
      }
      const nextScale = Math.min(width / BASE_PITCH_WIDTH, height / BASE_PITCH_HEIGHT);
      setScale(nextScale);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const mergedFieldRef = useMemo(
    () => mergeRefs<HTMLDivElement>(forwardedRef, fieldRef),
    [forwardedRef],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900">
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: BASE_PITCH_WIDTH,
          height: BASE_PITCH_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center',
        }}
      >
        <div
          ref={mergedFieldRef}
          className="relative h-full w-full"
          onDragOver={handleDragOver}
          onDrop={onPitchDrop}
        >
          <div className="absolute inset-0 opacity-80">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-white/60" pointerEvents="none">
              <rect x="0" y="0" width="100" height="100" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="1" />
              <circle cx="50" cy="50" r="9" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="16" y="0" width="68" height="16" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="16" y="84" width="68" height="16" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="30" y="0" width="40" height="6" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="30" y="94" width="40" height="6" stroke="currentColor" strokeWidth="1" fill="none" />
              <circle cx="50" cy="11" r="1.5" fill="currentColor" />
              <circle cx="50" cy="89" r="1.5" fill="currentColor" />
            </svg>
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <ArrowUp className="h-24 w-24 text-white/15" />
          </div>
          <div className="absolute inset-0">
            {slots.map(slot => (
              <div
                key={slot.slotIndex}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                onDragOver={handleDragOver}
                onDrop={event => onPositionDrop(event, slot)}
              >
                {slot.player ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PitchPlayerMarker
                        player={slot.player}
                        value={getMetricValue(slot.player, selectedMetric)}
                        metric={selectedMetric}
                        isFocused={slot.player.id === focusedPlayerId}
                        onSelect={() => onSelectPlayer(slot.player!.id)}
                        onDragStart={event => onPlayerDragStart(slot.player!, event)}
                        onDragEnd={event => onPlayerDragEnd(slot.player!, event)}
                      />
                    </TooltipTrigger>
                    <TooltipContent className="z-50 w-56 space-y-2">
                      {renderTooltip(slot.player)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex h-[3.6rem] w-[3.6rem] items-center justify-center rounded-full border border-dashed border-white/50 bg-white/20 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    {slot.position}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

Pitch.displayName = 'Pitch';

export default Pitch;
