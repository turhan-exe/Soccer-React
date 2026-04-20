import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WHATSAPP_SUPPORT_HREF,
  WHATSAPP_SUPPORT_PHONE,
  openWhatsAppSupportWindow,
} from '@/services/support';

describe('support helpers', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('exposes the configured whatsapp support link and phone', () => {
    expect(WHATSAPP_SUPPORT_PHONE).toBe('+90 542 693 20 70');
    expect(WHATSAPP_SUPPORT_HREF).toContain('wa.me/905426932070');
  });

  it('opens the whatsapp support link in a new window', () => {
    const openMock = vi.fn(() => ({ closed: false }));

    Object.defineProperty(globalThis, 'window', {
      value: {
        open: openMock,
      },
      configurable: true,
      writable: true,
    });

    expect(openWhatsAppSupportWindow()).toBe(true);
    expect(openMock).toHaveBeenCalledWith(
      WHATSAPP_SUPPORT_HREF,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('returns false when the window object is unavailable', () => {
    Reflect.deleteProperty(globalThis, 'window');

    expect(openWhatsAppSupportWindow()).toBe(false);
  });
});
