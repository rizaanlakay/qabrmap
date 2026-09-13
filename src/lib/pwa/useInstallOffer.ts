'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  APP_INSTALLED_EVENT,
  INSTALLED_FLAG_KEY,
  INSTALL_OFFER_LAST_SHOWN_KEY,
  INSTALL_PROMPT_EVENT,
  InstallPlatform,
  detectInstallPlatform,
  shouldOfferInstall,
} from './installPrompt';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    // Stashed by the inline script in the root layout so an early event isn't missed before hydration
    __qabrmapInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

function isRunningAsInstalledApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or blocked storage: the offer may repeat, which is harmless
  }
}

function currentPlatform(): InstallPlatform {
  return detectInstallPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    hasNativePrompt: Boolean(window.__qabrmapInstallPrompt),
  });
}

// Offers installing the app at most once a week while `enabled`, unless it is already installed
export function useInstallOffer({ enabled, delayMs = 2500 }: { enabled: boolean; delayMs?: number }) {
  const [platform, setPlatform] = useState<InstallPlatform>('unsupported');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const refresh = () => setPlatform(currentPlatform());
    const handleInstalled = () => {
      setVisible(false);
      refresh();
    };
    refresh();
    window.addEventListener(INSTALL_PROMPT_EVENT, refresh);
    window.addEventListener(APP_INSTALLED_EVENT, handleInstalled);
    return () => {
      window.removeEventListener(INSTALL_PROMPT_EVENT, refresh);
      window.removeEventListener(APP_INSTALLED_EVENT, handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setVisible(false);
      return;
    }
    if (isRunningAsInstalledApp()) {
      writeStorage(INSTALLED_FLAG_KEY, '1');
      return;
    }

    // A native prompt means the browser knows the app isn't installed, even if an old flag says otherwise
    const installed = platform !== 'native' && readStorage(INSTALLED_FLAG_KEY) === '1';
    const storedLastShown = readStorage(INSTALL_OFFER_LAST_SHOWN_KEY);
    const lastShownAt = storedLastShown === null ? null : Number(storedLastShown);
    if (!shouldOfferInstall({ now: Date.now(), lastShownAt, installed, platform })) return;

    const timer = window.setTimeout(() => {
      writeStorage(INSTALL_OFFER_LAST_SHOWN_KEY, String(Date.now()));
      setVisible(true);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [enabled, platform, delayMs]);

  const install = useCallback(async () => {
    const promptEvent = window.__qabrmapInstallPrompt;
    setVisible(false);
    if (!promptEvent) return;
    // A prompt event can only be used once
    window.__qabrmapInstallPrompt = null;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') writeStorage(INSTALLED_FLAG_KEY, '1');
    } catch {
      // The browser refused to show the prompt; the offer returns next week
    }
    setPlatform(currentPlatform());
  }, []);

  const dismiss = useCallback(() => setVisible(false), []);

  return { visible: visible && platform !== 'unsupported', platform, install, dismiss };
}
