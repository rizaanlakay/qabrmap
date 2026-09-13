// When and how to offer installing QabrMap as an app

export const INSTALL_OFFER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const INSTALL_OFFER_LAST_SHOWN_KEY = 'qabrmap_install_offer_last_shown';
export const INSTALLED_FLAG_KEY = 'qabrmap_pwa_installed';

// Dispatched on window by the inline script in the root layout, which runs before React hydrates
export const INSTALL_PROMPT_EVENT = 'qabrmap:installprompt';
export const APP_INSTALLED_EVENT = 'qabrmap:appinstalled';

// native: the browser handed us a beforeinstallprompt event to trigger (Chrome, Edge, Samsung Internet)
// ios: iPhone/iPad browsers, which can only install through Share > Add to Home Screen
// unsupported: no install path from this browser, so nothing is offered
export type InstallPlatform = 'native' | 'ios' | 'unsupported';

export function detectInstallPlatform({
  userAgent,
  maxTouchPoints,
  hasNativePrompt,
}: {
  userAgent: string;
  maxTouchPoints: number;
  hasNativePrompt: boolean;
}): InstallPlatform {
  if (hasNativePrompt) return 'native';
  // iPadOS reports a Mac user agent, so fall back to touch support to tell them apart
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  // Facebook and Instagram in-app browsers have no Add to Home Screen option
  const isInAppBrowser = /FBAN|FBAV|Instagram/i.test(userAgent);
  return isIOS && !isInAppBrowser ? 'ios' : 'unsupported';
}

export function shouldOfferInstall({
  now,
  lastShownAt,
  installed,
  platform,
}: {
  now: number;
  lastShownAt: number | null;
  installed: boolean;
  platform: InstallPlatform;
}): boolean {
  if (installed || platform === 'unsupported') return false;
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return true;
  // A timestamp from the future means the device clock moved back; don't let that silence the offer
  return lastShownAt > now || now - lastShownAt >= INSTALL_OFFER_INTERVAL_MS;
}
