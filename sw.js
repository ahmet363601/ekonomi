/* ═══════════════════════════════════
   Düzgün Ekonomi Pro v5.1 - Service Worker.
   PWA Offline Support | Cihaz Yetkilendirme Uyumlu
═══════════════════════════════════ */

const CACHE_NAME = 'de-pro-v5-1';
const DYNAMIC_CACHE = 'de-pro-dynamic-v5-1';
const ASSET_CACHE = 'de-pro-assets-v5-1';
const BASE_PATH = '/ekonomi/';

// Önbelleğe alınacak statik dosyalar (BASE_PATH ile)
const STATIC_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`
];

// Önbelleğe alınacak harici kaynaklar
const EXTERNAL_URLS = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js'
];

// Install
self.addEventListener('install', event => {
  console.log('[SW v5.1] Installing...');
  
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(STATIC_URLS);
      }),
      caches.open(ASSET_CACHE).then(cache => {
        return cache.addAll(EXTERNAL_URLS.map(url => {
          return new Request(url, { mode: 'no-cors' });
        })).catch(err => {
          console.warn('[SW] External cache error:', url, err);
        });
      })
    ]).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate
self.addEventListener('activate', event => {
  console.log('[SW v5.1] Activating...');
  
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => {
          return key !== CACHE_NAME && key !== DYNAMIC_CACHE && key !== ASSET_CACHE;
        }).map(key => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => {
      console.log('[SW] Claiming clients...');
      return self.clients.claim();
    })
  );
});

// Fetch
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // API çağrılarını asla cache'leme
  if (event.request.url.includes('api.anthropic.com') ||
      event.request.url.includes('api.openai.com') ||
      event.request.url.includes('api.google.com')) {
    return;
  }
  
  // HTML sayfaları için (BASE_PATH kontrolü ile)
  if (event.request.mode === 'navigate' || 
      event.request.destination === 'document' ||
      url.pathname === BASE_PATH || 
      url.pathname === `${BASE_PATH}index.html` ||
      url.pathname === '/ekonomi/') {
    
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        return caches.match(`${BASE_PATH}index.html`);
      })
    );
    return;
  }
  
  // Statik dosyalar
  if (event.request.destination === 'style' ||
      event.request.destination === 'script' ||
      event.request.url.includes('.json')) {
    
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(ASSET_CACHE).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        }).catch(() => {
          return new Response('Resource not available offline', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'Content-Type': 'text/plain' }
          });
        });
      })
    );
    return;
  }
  
  // Görseller ve fontlar
  if (event.request.destination === 'image' ||
      event.request.destination === 'font') {
    
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        }).catch(() => {
          return new Response(null, { status: 204 });
        });
      })
    );
    return;
  }
  
  // Diğer istekler
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200 && response.type !== 'opaque') {
        const clone = response.clone();
        caches.open(DYNAMIC_CACHE).then(cache => {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(async () => {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      
      if (event.request.headers.get('accept')?.includes('application/json')) {
        return new Response(JSON.stringify({
          offline: true,
          message: 'Çevrimdışı mod. Veriler cihazda saklanır.'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response('Ağ hatası - Çevrimdışı', {
        status: 408,
        statusText: 'Request Timeout'
      });
    })
  );
});

// Background sync
self.addEventListener('periodicsync', event => {
  if (event.tag === 'archive-check') {
    event.waitUntil(checkAndArchive());
  }
});

async function checkAndArchive() {
  console.log('[SW] Periodic archive check');
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'PERIODIC_ARCHIVE_CHECK',
      timestamp: Date.now()
    });
  });
}

// Push notification
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Finansal durumunuzu kontrol edin',
    icon: `${BASE_PATH}icons/icon-192.png`,
    badge: `${BASE_PATH}icons/icon-96.png`,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || BASE_PATH
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Düzgün Ekonomi Pro', options)
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || BASE_PATH;
  
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(windowClients => {
      for (let client of windowClients) {
        if (client.url.includes(BASE_PATH) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});

// Message handling
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(DYNAMIC_CACHE).then(() => {
        console.log('[SW] Dynamic cache cleared');
        if (event.source) {
          event.source.postMessage({ type: 'CACHE_CLEARED' });
        }
      })
    );
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
