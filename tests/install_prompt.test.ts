import { describe, it, expect } from 'vitest';
import {
  detectInstallPlatform,
  shouldOfferInstall,
  INSTALL_OFFER_INTERVAL_MS,
} from '../src/lib/pwa/installPrompt';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const FIREFOX_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';

describe('PWA Install Offer Tests', () => {
  it('uses the native prompt whenever the browser provides one', () => {
    expect(detectInstallPlatform({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, hasNativePrompt: true })).toBe('native');
  });

  it('falls back to Add to Home Screen instructions on iPhone and iPad', () => {
    expect(detectInstallPlatform({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, hasNativePrompt: false })).toBe('ios');
    expect(detectInstallPlatform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 5, hasNativePrompt: false })).toBe('ios');
  });

  it('offers nothing where installing is not possible', () => {
    expect(detectInstallPlatform({ userAgent: IPAD_DESKTOP_MODE, maxTouchPoints: 0, hasNativePrompt: false })).toBe('unsupported');
    expect(detectInstallPlatform({ userAgent: FIREFOX_DESKTOP, maxTouchPoints: 0, hasNativePrompt: false })).toBe('unsupported');
    expect(
      detectInstallPlatform({ userAgent: `${IPHONE_SAFARI} Instagram 300.0`, maxTouchPoints: 5, hasNativePrompt: false })
    ).toBe('unsupported');
  });

  it('offers on the first visit and then at most once a week', () => {
    const now = Date.UTC(2026, 8, 14);
    expect(shouldOfferInstall({ now, lastShownAt: null, installed: false, platform: 'native' })).toBe(true);
    expect(shouldOfferInstall({ now, lastShownAt: now - 60_000, installed: false, platform: 'native' })).toBe(false);
    expect(
      shouldOfferInstall({ now, lastShownAt: now - INSTALL_OFFER_INTERVAL_MS + 1, installed: false, platform: 'ios' })
    ).toBe(false);
    expect(
      shouldOfferInstall({ now, lastShownAt: now - INSTALL_OFFER_INTERVAL_MS, installed: false, platform: 'ios' })
    ).toBe(true);
  });

  it('never offers once installed or on unsupported browsers', () => {
    const now = Date.UTC(2026, 8, 14);
    expect(shouldOfferInstall({ now, lastShownAt: null, installed: true, platform: 'native' })).toBe(false);
    expect(shouldOfferInstall({ now, lastShownAt: null, installed: false, platform: 'unsupported' })).toBe(false);
  });

  it('recovers when the stored timestamp is in the future or corrupt', () => {
    const now = Date.UTC(2026, 8, 14);
    expect(shouldOfferInstall({ now, lastShownAt: now + 86_400_000, installed: false, platform: 'native' })).toBe(true);
    expect(shouldOfferInstall({ now, lastShownAt: Number.NaN, installed: false, platform: 'native' })).toBe(true);
  });
});
