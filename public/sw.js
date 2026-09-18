// QabrMap Service Worker: app shell for the installed app plus offline resilience
const VERSION = 'v6';
const SHELL_CACHE = `qabrmap-shell-${VERSION}`;
const STATIC_CACHE = `qabrmap-static-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE];
const APP_SHELL_URL = '/';
const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/sample-gravestone.svg',
];
const MAX_STATIC_ENTRIES = 200;

self.addEventListener('install', (event) => {
  // Cache each asset on its own so one missing file doesn't leave the whole shell uncached
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => undefined))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function putInCache(cacheName, key, response, maxEntries) {
  const cache = await caches.open(cacheName);
  await cache.put(key, response);
  if (!maxEntries) return;
  // Cache keys come back oldest first
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map((old) => cache.delete(old)));
}

async function networkFirstPage(event, url) {
  try {
    const response = await fetch(event.request);
    // The app is a single page, so the latest home page doubles as the offline shell for every launch URL
    if (response.ok && url.pathname === APP_SHELL_URL) {
      event.waitUntil(putInCache(SHELL_CACHE, APP_SHELL_URL, response.clone()));
    }
    return response;
  } catch {
    const cached = (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match(APP_SHELL_URL));
    return cached || Response.error();
  }
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) event.waitUntil(putInCache(STATIC_CACHE, event.request, response.clone(), MAX_STATIC_ENTRIES));
  return response;
}

async function networkFirst(event) {
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(putInCache(STATIC_CACHE, event.request, response.clone(), MAX_STATIC_ENTRIES));
    return response;
  } catch {
    return (await caches.match(event.request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Supabase, Google map tiles and fonts go straight to the network; caching them filled storage without limit
  if (url.origin !== self.location.origin) return;
  // Never interfere with local development
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;
  // React Server Component payloads are per-render data, not assets
  if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ offline: true, error: 'Network unavailable. Using local offline cache.' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 503,
          })
      )
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event, url));
    return;
  }

  // Build output is content-hashed, so a cached copy is never stale
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event));
    return;
  }

  // Other public files: fresh when online, cached copy when offline
  event.respondWith(networkFirst(event));
});

// Background Sync for offline captures
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-graves') {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_BACKGROUND_SYNC' });
        });
      })
    );
  }
});
