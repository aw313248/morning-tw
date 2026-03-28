// MORNING TW — Service Worker
const CACHE = 'morning-tw-v1';
const PRECACHE = [
  '/',
  '/css/style.css',
  '/css/variables.css',
  '/js/app.js',
  '/js/map.js',
  '/js/recommender.js',
  '/data/breakfasts.json',
  '/favicon.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Only cache GET requests for same-origin static assets
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // Network-first for JSON data (always fresh), cache-first for static assets
  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});

// Push notification handler
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'MORNING TW', body: '你收藏的早餐店現在開門了！' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'morning-tw',
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('/'));
});
