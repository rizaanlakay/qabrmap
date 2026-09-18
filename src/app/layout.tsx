import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_INSTALLED_EVENT, INSTALLED_FLAG_KEY, INSTALL_PROMPT_EVENT } from '@/lib/pwa/installPrompt';

export const metadata: Metadata = {
  title: "Ta'awun Qabr Map - Find, Remember, Always",
  description: 'Digital mapping, AI gravestone analysis, and precision navigation for Muslim cemeteries.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: "Ta'awun Qabr Map",
  },
  other: {
    // Chromium's counterpart to apple-mobile-web-app-capable
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#143A2E',
};

import { AppProviders } from '@/components/providers/AppProviders';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-900">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Amiri:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Hold Chrome's install prompt for the weekly in-app offer instead of its own mini-infobar.
              // Registered before hydration because the event can fire before React mounts.
              window.addEventListener('beforeinstallprompt', function (e) {
                e.preventDefault();
                window.__qabrmapInstallPrompt = e;
                window.dispatchEvent(new Event('${INSTALL_PROMPT_EVENT}'));
              });
              window.addEventListener('appinstalled', function () {
                window.__qabrmapInstallPrompt = null;
                try { localStorage.setItem('${INSTALLED_FLAG_KEY}', '1'); } catch (e) {}
                window.dispatchEvent(new Event('${APP_INSTALLED_EVENT}'));
              });

              if ('serviceWorker' in navigator) {
                if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                  window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW failed', err));
                  });
                  // A page that already had a worker is running an older build once a new worker takes over,
                  // so reload it once. A first install also fires this, but with no previous controller.
                  if (navigator.serviceWorker.controller) {
                    let reloaded = false;
                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                      if (reloaded) return;
                      reloaded = true;
                      window.location.reload();
                    });
                  }
                } else {
                  navigator.serviceWorker.getRegistrations().then(registrations => {
                    for (const reg of registrations) reg.unregister();
                  });
                  if ('caches' in window) {
                    caches.keys().then(names => {
                      for (const name of names) caches.delete(name);
                    });
                  }
                }
              }
            `,
          }}
        />
      </head>
      <body className="h-full w-full bg-slate-950 select-none overflow-x-hidden">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
