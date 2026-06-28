// Aldi Cart service worker.
//
// Scope: cache the Next.js app shell so the PWA loads instantly and
// can render an offline UI. The actual catalogue data already
// lives in the client's IndexedDB cache (src/lib/client/catalogue.ts)
// — this SW only handles the static asset shell, not the API.
//
// Strategy:
//   - Pre-cache the manifest, icons, and the root page at install.
//   - Network-first for HTML/navigation requests (so updates land
//     quickly) with a cache fallback so the shell still loads offline.
//   - Cache-first for static hashed assets (`/_next/static/*`) and
//     icons (safe — they have content-hash filenames in /_next/static).
//
// No push notifications, no background sync — those are out of scope.

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `aldi-shell-static-${CACHE_VERSION}`;
const PAGES_CACHE = `aldi-shell-pages-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] precache failed:', err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== PAGES_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icon-') ||
  url.pathname === '/apple-touch-icon.png' ||
  url.pathname === '/favicon.ico';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Cache-first for hashed static assets.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Network-first for navigations and other GETs, falling back to the
  // pages cache so an offline launch shows the last-rendered shell.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGES_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Default: pass-through, no cache.
});
