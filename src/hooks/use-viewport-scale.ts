import type { RefObject } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';

type ViewportScaleOptions = {
  minScale?: number;
  maxScale?: number;
};

type ViewportScaleResult<T extends HTMLElement> = {
  contentRef: RefObject<T>;
  scale: number;
};

const DEFAULT_MIN_SCALE = 0.55;

export function useViewportScale<T extends HTMLElement>(
  enabled: boolean,
  options: ViewportScaleOptions = {},
): ViewportScaleResult<T> {
  const { minScale = DEFAULT_MIN_SCALE, maxScale = 1 } = options;
  const contentRef = useRef<T>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!enabled) {
      setScale(1);
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const clampScale = (value: number) => {
      const bounded = Math.min(maxScale, Math.max(minScale, value));
      return Number.isFinite(bounded) ? bounded : 1;
    };

    let rafId = 0;

    const measure = () => {
      const node = contentRef.current;
      if (!node) {
        return;
      }
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      if (!viewportHeight) {
        setScale(1);
        return;
      }
      const contentHeight = node.offsetHeight;
      if (!contentHeight) {
        setScale(1);
        return;
      }
      const rawScale = viewportHeight / contentHeight;
      const nextScale = clampScale(Number(rawScale.toFixed(3)));
      setScale(prev => (Math.abs(prev - nextScale) < 0.005 ? prev : nextScale));
    };

    const scheduleMeasure = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(measure);
    };

    scheduleMeasure();

    const node = contentRef.current;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleMeasure();
          })
        : undefined;

    if (observer && node) {
      observer.observe(node);
    }

    const handleResize = () => {
      scheduleMeasure();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [enabled, maxScale, minScale]);

  return {
    contentRef,
    scale,
  };
}
