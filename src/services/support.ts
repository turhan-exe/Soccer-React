export const WHATSAPP_SUPPORT_PHONE = '+90 542 693 20 70';
export const WHATSAPP_SUPPORT_HREF =
  'https://wa.me/905426932070?text=Merhaba%2C%20oyun%20icinde%20bir%20sorun%20yasadim%20ve%20destek%20almak%20istiyorum.';

export const openWhatsAppSupportWindow = (): boolean => {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return false;
  }

  try {
    return window.open(WHATSAPP_SUPPORT_HREF, '_blank', 'noopener,noreferrer') !== null;
  } catch {
    return false;
  }
};
