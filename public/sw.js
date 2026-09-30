const CACHE_NAME = 'sachin-shell-v2';
const SHELL = [
  '/', '/index.html', '/onboarding.html', '/app.html', '/widget.html',
  '/manifest.webmanifest', '/sachin-logo.png', '/sachin-logo-192.png',
  '/css/tokens.css', '/css/landing.css', '/css/onboarding.css', '/css/app.css', '/css/widget.css',
  '/js/api.js', '/js/onboarding.js', '/js/app.js', '/js/voice.js', '/js/billing.js', '/js/widget.js', '/js/widget-embed.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match('/index.html'))));
    return;
  }

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
