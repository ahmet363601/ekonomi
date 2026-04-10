/* ═══════════════════════════════════════════════════════════════════════════
Düzgün Ekonomi Pro v6.0 - Service Worker
PWA Offline Support & Caching Strategy
═══════════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = ‘de-pro-v6-0’;
const STATIC_CACHE = ‘de-pro-static-v6’;
const DYNAMIC_CACHE = ‘de-pro-dynamic-v6’;

// Pre-cache resources
const STATIC_ASSETS = [
‘/’,
‘/index.html’,
‘/manifest.json’
];

const EXTERNAL_URLS = [
‘https://cdn.jsdelivr.net/npm/dexie@3/dist/dexie.min.js’,
‘https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js’,
‘https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css’,
‘https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap’
];

/* ═════════════════════════════════════════════════════════════════════
INSTALL EVENT - Cache static assets
═════════════════════════════════════════════════════════════════════ */
self.addEventListener(‘install’, event => {
console.log(’[SW v6.0] Installing…’);

event.waitUntil(
Promise.all([
// Cache HTML & JSON
caches.open(CACHE_NAME).then(cache => {
return cache.addAll(STATIC_ASSETS).catch(err => {
console.warn(’[SW] Static cache error:’, err);
});
}),
// Cache external libraries
caches.open(STATIC_CACHE).then(cache => {
return cache.addAll(
EXTERNAL_URLS.map(url => new Request(url, { mode: ‘no-cors’ }))
).catch(err => {
console.warn(’[SW] External cache error:’, err);
});
})
]).then(() => {
return self.skipWaiting();
})
);
});

/* ═════════════════════════════════════════════════════════════════════
ACTIVATE EVENT - Clean old caches
═════════════════════════════════════════════════════════════════════ */
self.addEventListener(‘activate’, event => {
console.log(’[SW v6.0] Activating…’);

event.waitUntil(
caches.keys().then(keys => {
return Promise.all(
keys
.filter(key => !key.includes(‘v6-0’) && !key.includes(‘v6’))
.map(key => {
console.log(’[SW] Deleting old cache:’, key);
return caches.delete(key);
})
);
}).then(() => {
return self.clients.claim();
})
);
});

/* ═════════════════════════════════════════════════════════════════════
FETCH EVENT - Serving strategy
═════════════════════════════════════════════════════════════════════ */
self.addEventListener(‘fetch’, event => {
const url = new URL(event.request.url);

// Skip API requests (IndexedDB is local)
if (event.request.url.includes(‘api.’)) {
return;
}

// HTML pages - Network first with cache fallback
if (event.request.mode === ‘navigate’ || url.pathname.endsWith(’.html’)) {
event.respondWith(
fetch(event.request)
.then(response => {
// Update cache with new version
if (response && response.status === 200) {
const clone = response.clone();
caches.open(CACHE_NAME).then(cache => {
cache.put(event.request, clone);
});
}
return response;
})
.catch(() => {
// Offline: serve from cache
return caches.match(event.request)
.then(cached => cached || caches.match(’/index.html’));
})
);
return;
}

// Static assets - Cache first with network fallback
if (
event.request.destination === ‘style’ ||
event.request.destination === ‘script’ ||
event.request.destination === ‘font’ ||
event.request.destination === ‘image’
) {
event.respondWith(
caches.match(event.request)
.then(cached => {
if (cached) return cached;

```
      return fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200) return response;

          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          // Offline fallback for images
          if (event.request.destination === 'image') {
            return new Response(null, { status: 204 });
          }
          return new Response('Resource not available offline', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
    })
);
return;
```

}

// Default - Network first
event.respondWith(
fetch(event.request)
.then(response => {
if (response && response.status === 200) {
const clone = response.clone();
caches.open(DYNAMIC_CACHE).then(cache => {
cache.put(event.request, clone);
});
}
return response;
})
.catch(() => {
return caches.match(event.request)
.then(cached => cached || new Response(‘Offline’, { status: 503 }));
})
);
});

/* ═════════════════════════════════════════════════════════════════════
MESSAGE HANDLING
═════════════════════════════════════════════════════════════════════ */
self.addEventListener(‘message’, event => {
if (event.data && event.data.type === ‘SKIP_WAITING’) {
self.skipWaiting();
}

if (event.data && event.data.type === ‘CLEAR_CACHE’) {
caches.delete(DYNAMIC_CACHE).then(() => {
event.source.postMessage({ type: ‘CACHE_CLEARED’ });
});
}
});

console.log(’[SW] Service Worker v6.0 loaded’);