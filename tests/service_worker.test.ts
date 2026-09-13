import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Runs the real public/sw.js in a sandbox with in-memory caches and a scripted network
const ORIGIN = 'https://qabrmap.vercel.app';
const SW_SOURCE = readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
}
type Network = (request: FakeRequest) => Promise<Response>;
type CacheKey = string | { url: string };

const request = (pathOrUrl: string, mode = 'no-cors'): FakeRequest => ({
  url: new URL(pathOrUrl, ORIGIN).href,
  method: 'GET',
  mode,
  headers: new Headers(),
});
const reply = (body: string, status = 200) => new Response(body, { status });

function loadServiceWorker(network: Network) {
  const listeners: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (key: CacheKey) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;
  const withoutSearch = (href: string) => href.split('?')[0];

  const openCache = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (key: CacheKey, options?: { ignoreSearch?: boolean }) => {
        const href = keyOf(key);
        const hit = Array.from(store.entries()).find(
          ([stored]) => stored === href || (options?.ignoreSearch && withoutSearch(stored) === withoutSearch(href))
        );
        return hit ? hit[1].clone() : undefined;
      },
      put: async (key: CacheKey, response: Response) => {
        store.set(keyOf(key), response);
      },
      add: async (key: CacheKey) => {
        const response = await network(request(keyOf(key)));
        if (!response.ok) throw new TypeError('Request failed');
        store.set(keyOf(key), response);
      },
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (key: CacheKey) => store.delete(keyOf(key)),
    };
  };

  const caches = {
    open: async (name: string) => openCache(name),
    match: async (key: CacheKey, options?: { ignoreSearch?: boolean }) => {
      for (const name of Array.from(stores.keys())) {
        const hit = await openCache(name).match(key, options);
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => Array.from(stores.keys()),
    delete: async (name: string) => stores.delete(name),
  };

  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, listener: (event: any) => void) => {
      listeners[type] = listener;
    },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
  };

  vm.runInContext(SW_SOURCE, vm.createContext({ self, caches, fetch: network, Response, Headers, URL, console }));
  return { listeners, stores };
}

async function dispatchFetch(sw: ReturnType<typeof loadServiceWorker>, fetchRequest: FakeRequest) {
  let pending: Promise<Response> | undefined;
  const lifetime: Promise<unknown>[] = [];
  sw.listeners.fetch({
    request: fetchRequest,
    respondWith: (response: Promise<Response>) => {
      pending = Promise.resolve(response);
    },
    waitUntil: (promise: Promise<unknown>) => {
      lifetime.push(promise);
    },
  });
  const response = pending ? await pending : undefined;
  await Promise.all(lifetime);
  return { intercepted: pending !== undefined, response };
}

describe('Service Worker Caching Tests', () => {
  it('leaves cross-origin requests such as Supabase and map tiles to the network', async () => {
    const sw = loadServiceWorker(async () => reply('ok'));
    for (const url of ['https://abc.supabase.co/rest/v1/graves?select=*', 'https://mt0.google.com/vt/lyrs=y&x=1&y=2&z=3']) {
      expect((await dispatchFetch(sw, request(url))).intercepted).toBe(false);
    }
    expect(sw.stores.size).toBe(0);
  });

  it('serves the cached app shell for any launch URL when offline', async () => {
    let online = true;
    const sw = loadServiceWorker(async (r) => {
      if (!online) throw new TypeError('Failed to fetch');
      return reply(`<html>${new URL(r.url).pathname}</html>`);
    });

    await dispatchFetch(sw, request('/', 'navigate'));
    online = false;
    const { response } = await dispatchFetch(sw, request('/?grave=grave_8660', 'navigate'));
    expect(await response!.text()).toBe('<html>/</html>');
  });

  it('does not cache failed responses', async () => {
    const sw = loadServiceWorker(async () => reply('missing', 404));
    const { response } = await dispatchFetch(sw, request('/_next/static/chunks/app.js'));
    expect(response!.status).toBe(404);
    expect(sw.stores.get('qabrmap-static-v3')?.size ?? 0).toBe(0);
  });

  it('answers API calls with an offline JSON error when the network is down', async () => {
    const sw = loadServiceWorker(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { response } = await dispatchFetch(sw, request('/api/graves/search?q=abdul'));
    expect(response!.status).toBe(503);
    expect(await response!.json()).toMatchObject({ offline: true });
  });

  it('caps the static cache and evicts the oldest entries', async () => {
    const sw = loadServiceWorker(async () => reply('chunk'));
    for (let i = 0; i < 205; i++) {
      await dispatchFetch(sw, request(`/_next/static/chunks/${i}.js`));
    }
    const cached = Array.from(sw.stores.get('qabrmap-static-v3')!.keys());
    expect(cached).toHaveLength(200);
    expect(cached[0]).toBe(`${ORIGIN}/_next/static/chunks/5.js`);
  });

  it('removes caches from older service worker versions on activate', async () => {
    const sw = loadServiceWorker(async () => reply('ok'));
    sw.stores.set('qabrmap-v2', new Map([[`${ORIGIN}/`, reply('old')]]));
    sw.stores.set('qabrmap-static-v3', new Map());

    const lifetime: Promise<unknown>[] = [];
    sw.listeners.activate({ waitUntil: (promise: Promise<unknown>) => lifetime.push(promise) });
    await Promise.all(lifetime);

    expect(Array.from(sw.stores.keys())).toEqual(['qabrmap-static-v3']);
  });
});
