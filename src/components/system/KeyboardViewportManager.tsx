import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

const KEYBOARD_OPEN_THRESHOLD = 96;
const SCROLL_MARGIN = 24;
const FOCUS_SCROLL_DELAYS_MS = [32, 180, 360];
const EDITABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
  'select:not([disabled])',
  '[contenteditable="true"]',
  '[contenteditable=""]',
].join(',');

const isEditableElement = (value: EventTarget | Element | null): value is HTMLElement => {
  if (!(value instanceof HTMLElement)) {
    return false;
  }

  return value.matches(EDITABLE_SELECTOR);
};

const getViewportHeight = () => {
  const visualViewportHeight = window.visualViewport?.height;
  if (typeof visualViewportHeight === 'number' && Number.isFinite(visualViewportHeight) && visualViewportHeight > 0) {
    return visualViewportHeight;
  }

  return window.innerHeight;
};

const getPreferredScrollContainer = (element: HTMLElement): HTMLElement | null => {
  const explicitContainer = element.closest<HTMLElement>('[data-keyboard-scroll-container], [data-app-scroll-container]');
  if (explicitContainer) {
    return explicitContainer;
  }

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const isScrollable = /(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight + 1;
    if (isScrollable) {
      return current;
    }

    current = current.parentElement;
  }

  return (document.querySelector('[data-app-scroll-container]') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null);
};

const scrollContainerBy = (container: HTMLElement | null, delta: number) => {
  if (!container || Math.abs(delta) < 1) {
    return;
  }

  if (container === document.body || container === document.documentElement || container === document.scrollingElement) {
    window.scrollBy({ top: delta, left: 0, behavior: 'auto' });
    return;
  }

  container.scrollTop += delta;
};

const keepFocusedElementVisible = (element: HTMLElement | null) => {
  if (!element || !document.contains(element)) {
    return;
  }

  const viewportHeight = getViewportHeight();
  const preferredContainer = getPreferredScrollContainer(element);

  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });

  requestAnimationFrame(() => {
    const rect = element.getBoundingClientRect();
    const containerRect =
      preferredContainer && preferredContainer !== document.body && preferredContainer !== document.documentElement && preferredContainer !== document.scrollingElement
        ? preferredContainer.getBoundingClientRect()
        : null;

    const visibleTop = Math.max(SCROLL_MARGIN, containerRect?.top ?? SCROLL_MARGIN);
    const visibleBottom = Math.min(viewportHeight - SCROLL_MARGIN, containerRect?.bottom ?? viewportHeight - SCROLL_MARGIN);

    if (rect.bottom > visibleBottom) {
      scrollContainerBy(preferredContainer, rect.bottom - visibleBottom + SCROLL_MARGIN);
    } else if (rect.top < visibleTop) {
      scrollContainerBy(preferredContainer, rect.top - visibleTop - SCROLL_MARGIN);
    }
  });
};

const KeyboardViewportManager = () => {
  useEffect(() => {
    const root = document.documentElement;
    const isNativeApp = Capacitor.isNativePlatform();
    let baselineViewportHeight = getViewportHeight();
    let focusTimers: number[] = [];

    root.dataset.nativeApp = isNativeApp ? 'true' : 'false';

    const clearFocusTimers = () => {
      focusTimers.forEach((timerId) => window.clearTimeout(timerId));
      focusTimers = [];
    };

    const updateViewportState = () => {
      const viewportHeight = getViewportHeight();
      if (viewportHeight > baselineViewportHeight + 48) {
        baselineViewportHeight = viewportHeight;
      }

      const keyboardOffset = Math.max(0, baselineViewportHeight - viewportHeight);
      const keyboardOpen = keyboardOffset >= KEYBOARD_OPEN_THRESHOLD;

      root.style.setProperty('--app-viewport-height', `${Math.round(viewportHeight)}px`);
      root.style.setProperty('--keyboard-offset', `${Math.round(keyboardOpen ? keyboardOffset : 0)}px`);
      root.dataset.keyboardOpen = keyboardOpen ? 'true' : 'false';

      const activeElement = document.activeElement;
      if (keyboardOpen && isEditableElement(activeElement)) {
        keepFocusedElementVisible(activeElement);
      }
    };

    const scheduleFocusedElementVisibility = (target: HTMLElement) => {
      clearFocusTimers();
      focusTimers = FOCUS_SCROLL_DELAYS_MS.map((delayMs) =>
        window.setTimeout(() => {
          keepFocusedElementVisible(target);
        }, delayMs)
      );
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isEditableElement(event.target)) {
        return;
      }

      scheduleFocusedElementVisibility(event.target);
    };

    const handleFocusOut = () => {
      clearFocusTimers();
      window.setTimeout(() => {
        if (!isEditableElement(document.activeElement)) {
          updateViewportState();
        }
      }, 60);
    };

    const handleOrientationChange = () => {
      window.setTimeout(() => {
        baselineViewportHeight = getViewportHeight();
        updateViewportState();
      }, 120);
    };

    updateViewportState();

    window.addEventListener('resize', updateViewportState, { passive: true });
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('focusin', handleFocusIn, true);
    window.addEventListener('focusout', handleFocusOut, true);

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener('resize', updateViewportState);
      visualViewport.addEventListener('scroll', updateViewportState);
    }

    return () => {
      clearFocusTimers();
      window.removeEventListener('resize', updateViewportState);
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('focusin', handleFocusIn, true);
      window.removeEventListener('focusout', handleFocusOut, true);

      if (visualViewport) {
        visualViewport.removeEventListener('resize', updateViewportState);
        visualViewport.removeEventListener('scroll', updateViewportState);
      }
    };
  }, []);

  return null;
};

export default KeyboardViewportManager;
