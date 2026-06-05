// PiWeeZa — Service Worker
const CACHE = 'piweeза-v1';

// Pre-cache the app shells so they launch offline
const SHELL = ['/mozo', '/repartidor', '/portal', '/admin'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(SHELL.map(url => cache.add(url)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const { pathname } = new URL(e.request.url);
  // Never intercept API or socket.io — always need fresh data
  if (pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')) return;

  // Network-first: serve fresh, cache for offline fallback
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
