import { useEffect, useRef } from 'react';

export interface SwipeDownOptions {
  onSwipeDown: () => void;
  threshold?: number;
  timeMax?: number;
  disabled?: boolean;
}

const DEFAULT_THRESHOLD = 40;
const DEFAULT_TIME_MAX = 350;

interface SwipeState {
  startX: number;
  startY: number;
  startTime: number;
  isActive: boolean;
}

const INPUT_SELECTOR = 'input, textarea, [contenteditable="true"]';

export const useSwipeDownReveal = ({
  onSwipeDown,
  threshold = DEFAULT_THRESHOLD,
  timeMax = DEFAULT_TIME_MAX,
  disabled = false,
}: SwipeDownOptions) => {
  const swipeStateRef = useRef<SwipeState>({
    startX: 0,
    startY: 0,
    startTime: 0,
    isActive: false,
  });

  useEffect(() => {
    if (disabled) {
      return;
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        swipeStateRef.current.isActive = false;
        return;
      }

      const touch = event.touches[0];
      const target = event.target as HTMLElement | null;

      if (target) {
        const focusedInput = target.closest(INPUT_SELECTOR);
        if (focusedInput && focusedInput === document.activeElement) {
          swipeStateRef.current.isActive = false;
          return;
        }
      }

      swipeStateRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: performance.now(),
        isActive: true,
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!swipeStateRef.current.isActive || event.touches.length !== 1) {
        return;
      }

      const touch = event.touches[0];
      const deltaX = touch.clientX - swipeStateRef.current.startX;
      const deltaY = touch.clientY - swipeStateRef.current.startY;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        swipeStateRef.current.isActive = false;
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!swipeStateRef.current.isActive || event.changedTouches.length === 0) {
        return;
      }

      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - swipeStateRef.current.startX;
      const deltaY = touch.clientY - swipeStateRef.current.startY;
      const elapsed = performance.now() - swipeStateRef.current.startTime;

      swipeStateRef.current.isActive = false;

      if (
        deltaY >= threshold &&
        deltaY > Math.abs(deltaX) &&
        elapsed <= timeMax
      ) {
        onSwipeDown();
      }
    };

    const handleTouchCancel = () => {
      swipeStateRef.current.isActive = false;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [disabled, onSwipeDown, threshold, timeMax]);
};

export const SWIPE_DOWN_DEFAULTS = {
  threshold: DEFAULT_THRESHOLD,
  timeMax: DEFAULT_TIME_MAX,
} as const;

export type UseSwipeDownReveal = typeof useSwipeDownReveal;
