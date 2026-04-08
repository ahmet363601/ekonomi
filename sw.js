/* ═══════════════════════════════════
   Düzgün Ekonomi Pro v5.0 - Service Worker
   PWA Offline Support - Gelişmiş Sürüm
═══════════════════════════════════ */

const CACHE_NAME = 'de-pro-v5';
const DYNAMIC_CACHE = 'de-pro-dynamic-v5';
const ASSET_CACHE = 'de-pro-assets-v5';

// Önbelleğe alınacak statik dosyalar
const STATIC_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Önbelleğe alınacak harici kaynaklar
const EXTERNAL_URLS = [
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js'
];

// Cache'e eklenecek API'ler (offline mock)
const API_URLS = [];

// Install - Statik dosyaları önbelleğe al
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    Promise.all([
      // Statik dosyaları cache'le
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(STATIC_URLS);
      }),
      // Harici kaynakları cache'le
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

// Activate - Eski cache'leri temizle
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  
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

// Fetch - Ağ isteklerini yönet
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // API çağrılarını asla cache'leme (Anthropic vs.)
  if (event.request.url.includes('api.anthropic.com') ||
      event.request.url.includes('api.openai.com') ||
      event.request.url.includes('api.google.com')) {
    return;
  }
  
  // HTML sayfaları için (her zaman en güncel)
  if (event.request.mode === 'navigate' || 
      event.request.destination === 'document' ||
      url.pathname === '/' || 
      url.pathname === '/index.html') {
    
    event.respondWith(
      fetch(event.request).then(response => {
        // Başarılı yanıtı cache'le
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(async () => {
        // Offline: cache'den dön
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        
        // Ana sayfayı döndür
        return caches.match('/index.html');
      })
    );
    return;
  }
  
  // Statik dosyalar (CSS, JS, manifest)
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
          // Offline: 404 sayfası veya boş response
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
          // Offline: placeholder görsel
          return new Response(null, { status: 204 });
        });
      })
    );
    return;
  }
  
  // Diğer tüm istekler - Network first, cache fallback
  event.respondWith(
    fetch(event.request).then(response => {
      // Başarılı yanıtları dynamic cache'e ekle
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
      
      // Offline: JSON istekleri için mock data
      if (event.request.headers.get('accept')?.includes('application/json')) {
        return new Response(JSON.stringify({
          offline: true,
          message: 'You are offline. Data will sync when connection returns.'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      return new Response('Network error occurred', {
        status: 408,
        statusText: 'Request Timeout'
      });
    })
  );
});

// Background sync - Periodik senkronizasyon
self.addEventListener('periodicsync', event => {
  if (event.tag === 'archive-check') {
    event.waitUntil(checkAndArchive());
  }
});

// Background sync fonksiyonu
async function checkAndArchive() {
  console.log('[SW] Running periodic archive check');
  
  // Client'lara mesaj gönder
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'PERIODIC_ARCHIVE_CHECK',
      timestamp: Date.now()
    });
  });
}

// Push notification desteği
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Finansal durumunuzu kontrol edin',
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Ccircle cx="48" cy="48" r="48" fill="%233b82f6"/%3E%3Ctext x="48" y="68" text-anchor="middle" fill="white" font-size="50"%3E💰%3C/text%3E%3C/svg%3E',
    badge: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"%3E%3Ccircle cx="48" cy="48" r="48" fill="%233b82f6"/%3E%3Ctext x="48" y="68" text-anchor="middle" fill="white" font-size="45"%3E💰%3C/text%3E%3C/svg%3E',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Düzgün Ekonomi Pro', options)
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(windowClients => {
      // Zaten açık bir pencere varsa onu kullan
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Yoksa yeni pencere aç
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
