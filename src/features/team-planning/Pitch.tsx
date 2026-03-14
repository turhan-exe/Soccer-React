import React, { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Shirt } from 'lucide-react';
import type { Player } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getPositionShortLabel } from './teamPlanningUtils';
import { getZoneShortCode } from './slotZones';
import type { PitchSlot } from './teamPlanningUtils';
export type { PitchSlot };
import type { MetricKey } from './useTeamPlanningStore';

// Base reference width for marker scaling only.
// The pitch itself will now stretch to 100% of container.
const REF_WIDTH = 2400;
const PITCH_MARKER_SIZE = 75;



type PitchProps = {
  slots: PitchSlot[];
  onPitchDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onPositionDrop: (event: React.DragEvent<HTMLDivElement>, slot: PitchSlot) => void;
  onPlayerDragStart: (player: Player, event: React.DragEvent<HTMLDivElement>) => void;
  onPlayerDragEnd: (player: Player, event: React.DragEvent<HTMLDivElement>) => void;
  onSelectPlayer: (playerId: string) => void;
  onSelectSlot?: (slot: PitchSlot) => void;
  focusedPlayerId: string | null;
  selectedMetric: MetricKey;
  getMetricValue: (player: Player, metric: MetricKey) => number;
  renderTooltip: (player: Player) => React.ReactNode;
  isExpanded?: boolean;
  onBackgroundClick?: () => void;
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
  const [isPressing, setIsPressing] = useState(false);
  const pressTimeoutRef = useRef<number | null>(null);

  const clearPressTimeout = useCallback(() => {
    if (pressTimeoutRef.current !== null) {
      window.clearTimeout(pressTimeoutRef.current);
      pressTimeoutRef.current = null;
    }
  }, []);

  const handlePressStart = useCallback(() => {
    clearPressTimeout();
    pressTimeoutRef.current = window.setTimeout(() => {
      setIsPressing(true);
      pressTimeoutRef.current = null;
    }, 140);
  }, [clearPressTimeout]);

  const handlePressEnd = useCallback(() => {
    clearPressTimeout();
    setIsPressing(false);
  }, [clearPressTimeout]);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      clearPressTimeout();
      setIsPressing(true);
      onDragStart(event);
    },
    [clearPressTimeout, onDragStart],
  );

  const handleDragEnd = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      clearPressTimeout();
      setIsPressing(false);
      onDragEnd(event);
    },
    [clearPressTimeout, onDragEnd],
  );

  useEffect(() => {
    return () => {
      clearPressTimeout();
    };
  }, [clearPressTimeout]);

  const isSelected = isFocused || isPressing;

  // Touch handling for mobile drag
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };

    // Simulate Drag Start
    // Create a fake drag event to pass the player ID
    const fakeEvent = {
      dataTransfer: {
        setData: () => { },
        effectAllowed: 'move'
      },
      currentTarget: e.currentTarget
    } as unknown as React.DragEvent<HTMLDivElement>;

    // Trigger the parent's drag start logic (sets draggedPlayerId)
    handleDragStart(fakeEvent);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    // Prevent scrolling while dragging a player
    if (touchStartRef.current) {
      e.preventDefault();

      // Optional: Move a visual ghost here if we want advanced feedback
      const touch = e.touches[0];
      if (elementRef.current) {
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        elementRef.current.style.transform = `translate(${dx}px, ${dy}px) scale(1.2)`;
        elementRef.current.style.zIndex = '100';
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startPos = touchStartRef.current;
    touchStartRef.current = null;

    if (elementRef.current) {
      // Reset styles
      elementRef.current.style.transform = '';
      elementRef.current.style.zIndex = '';
    }

    if (!startPos) return;

    // Calculate final position
    const touch = e.changedTouches[0];

    // Create a fake event with the final coordinates
    // We pass these coordinates to the parent's handlePlayerDragEnd
    // Note: clientX/Y here are used by the parent to find the nearest slot
    const fakeEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      preventDefault: () => { },
      stopPropagation: () => { }
    } as unknown as React.DragEvent<HTMLDivElement>;

    // Trigger Drop Logic
    handleDragEnd(fakeEvent);
  };

  return (
    <div
      ref={elementRef}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={onSelect}
      onPointerDown={handlePressStart}
      onPointerUp={handlePressEnd}
      onPointerLeave={handlePressEnd}
      onPointerCancel={handlePressEnd}
      data-pressed={isPressing ? 'true' : undefined}
      className={cn(
        'relative flex cursor-grab flex-col items-center justify-center transition-transform duration-150 ease-out',
        isSelected ? 'scale-110' : 'hover:scale-105'
      )}
      style={{ width: PITCH_MARKER_SIZE, height: PITCH_MARKER_SIZE }}
    >
      <div className="relative flex items-center justify-center">
        <Shirt
          className={cn(
            "w-16 h-16 drop-shadow-xl",
            isSelected ? "text-orange-400 fill-orange-900" : "text-white fill-[#1a1725]"
          )}
          strokeWidth={1}
        />
        <span className="absolute inset-0 flex items-center justify-center font-black text-xl text-white pt-1">
          {formatMetricValue(metric, normalizedValue)}
        </span>
      </div>
      <span className="mt-1 w-auto max-w-[120px] rounded-md bg-black/60 px-2 py-1.5 text-xs font-bold text-white backdrop-blur-sm shadow-md text-center leading-3 min-h-[28px] flex items-center justify-center break-words whitespace-normal transform-gpu">
        {player.name}
      </span>
    </div >
  );
}; // End PitchPlayerMarker

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
    onSelectSlot,
    focusedPlayerId,
    selectedMetric,
    getMetricValue,
    renderTooltip,
    isExpanded = false,
    onBackgroundClick,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLDivElement | null>(null);
  const [markerScale, setMarkerScale] = useState(1);

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
      const { width } = entry.contentRect;
      if (width === 0) {
        return;
      }

      // Calculate scale just for markers based on width relative to reference
      const widthRatio = width / REF_WIDTH;

      // Marker scale logic
      let currentScale = Math.max(0.7, Math.min(1.2, widthRatio / 0.8));

      if (isExpanded) {
        currentScale *= 1.1;
      }
      setMarkerScale(currentScale);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isExpanded]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const mergedFieldRef = useMemo(
    () => mergeRefs<HTMLDivElement>(forwardedRef, fieldRef),
    [forwardedRef],
  );

  return (
    <div
      ref={containerRef}
      id="tp-pitch"
      style={{ width: '100%', height: '100%', borderRadius: '0px', border: 'none' }}
      className="tp-pitch-surface relative w-full h-full overflow-hidden bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 shadow-inner block p-0 rounded-none border-none"
    >
      {/* Inner container Set to 100% to fill outer container regardless of Aspect Ratio */}
      <div
        className="relative flex-shrink-0 transition-transform duration-150 ease-out origin-center"
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <div
          ref={mergedFieldRef}
          className="relative h-full w-full"
          onDragOver={handleDragOver}
          onDrop={onPitchDrop}
        >
          {/* Horizontal Field SVG lines */}
          <div className="absolute inset-0 opacity-60">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-white/50" pointerEvents="none" preserveAspectRatio="none">
              {/* 
                   FULL STRETCH LAYOUT
                   We use preserveAspectRatio="none" to forcibly stretch this SVG to fill the container.
                   This satisfies the requirement to "fill the screen even if distorted".

                   Field Geometry (92% width logic preserved for aesthetics):
                */}

              {/* Clickable background overlay */}
              <div className="absolute inset-0 z-0" onClick={() => onBackgroundClick?.()} />

              {/* Field Border: x=0->100, w=100 - Full Bleed */}
              <rect x="0" y="0" width="100" height="100" fill="none" stroke="currentColor" strokeWidth="1" />

              {/* Halfway Line */}
              <line x1="50" y1="0" x2="50" y2="100" stroke="currentColor" strokeWidth="1" />

              {/* Center Circle */}
              <circle cx="50" cy="50" r="9" stroke="currentColor" strokeWidth="1" fill="none" />
              <circle cx="50" cy="50" r="1" fill="currentColor" />

              {/* Left Goal Area */}
              <rect x="0" y="36" width="5" height="28" stroke="currentColor" strokeWidth="1" fill="none" />
              {/* Left Penalty Area */}
              <rect x="0" y="22" width="14" height="56" stroke="currentColor" strokeWidth="1" fill="none" />
              {/* Left Penalty Spot */}
              <circle cx="10" cy="50" r="0.5" fill="currentColor" />
              {/* Left Penalty Arc */}
              <path d="M 14 40 A 10 10 0 0 1 14 60" stroke="currentColor" strokeWidth="1" fill="none" />


              {/* Right Goal Area */}
              <rect x="95" y="36" width="5" height="28" stroke="currentColor" strokeWidth="1" fill="none" />
              {/* Right Penalty Area */}
              <rect x="86" y="22" width="14" height="56" stroke="currentColor" strokeWidth="1" fill="none" />
              {/* Right Penalty Spot */}
              <circle cx="90" cy="50" r="0.5" fill="currentColor" />
              {/* Right Penalty Arc */}
              <path d="M 86 40 A 10 10 0 0 0 86 60" stroke="currentColor" strokeWidth="1" fill="none" />

            </svg>
          </div>

          <div className="absolute inset-0">
            {slots.map(slot => {
              // Coordinate logic matches SVG geometry (4% padding)
              // Since SVG stretches 100%, these % values map perfectly to the visual elements.

              const x_orig = 100 - slot.y;
              const horizX = x_orig; // Pure 0-100 mapping

              const y_raw = slot.x;
              const horizY = y_raw; // Pure 0-100 mapping

              return (
                <div
                  key={slot.slotIndex}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{ left: `${horizX}% `, top: `${horizY}% ` }}
                  onDragOver={handleDragOver}
                  onDrop={event => onPositionDrop(event, slot)}
                  onClick={e => {
                    e.stopPropagation();
                    onSelectSlot?.(slot);
                  }}
                >
                  {slot.player ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div style={{ transform: `scale(${markerScale})`, transformOrigin: 'center' }}>
                          <PitchPlayerMarker
                            player={slot.player}
                            value={getMetricValue(slot.player, selectedMetric)}
                            metric={selectedMetric}
                            isFocused={slot.player.id === focusedPlayerId}
                            onSelect={() => onSelectPlayer(slot.player!.id)}
                            onDragStart={event => onPlayerDragStart(slot.player!, event)}
                            onDragEnd={event => onPlayerDragEnd(slot.player!, event)}
                          />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="z-50 w-56 space-y-2">
                        {renderTooltip(slot.player)}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <div
                      className="flex h-[3.5rem] w-[3.5rem] items-center justify-center rounded-full border-2 border-dashed border-white/30 bg-white/5 px-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-100/50"
                      style={{ transform: `scale(${markerScale})`, transformOrigin: 'center' }}
                    >
                      {getZoneShortCode(slot)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

Pitch.displayName = 'Pitch';

export default Pitch;
