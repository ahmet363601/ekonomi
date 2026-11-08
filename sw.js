/* ═══════════════════════════════════════════════════════════════
   Bütçem Pro — Service Worker
   ─────────────────────────────────────────────────────────────
   Sürüm : 6.0
   Scope : /ekonomi/
   
   Strateji Haritası
   ─────────────────
   • HTML (navigate/document)   → NETWORK-FIRST + no-store + timeout
   • Statik asset (CSS/JS/JSON) → STALE-WHILE-REVALIDATE
   • Görsel/Font                → CACHE-FIRST
   • API (anthropic/openai vs.) → BYPASS
   • Diğer                      → NETWORK-FIRST + offline fallback
   
   Güncelleme kuralı
   ─────────────────
   Her deploy'da yalnızca SW_VERSION değişkenini artırın
   (6.0 → 6.1 → 6.2 …). Activate eski cache'leri temizler,
   skipWaiting + clients.claim açık sekmeleri anında devralır.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   SÜRÜM & SABİTLER
───────────────────────────────────────────── */
const SW_VERSION    = '6.0';
const BASE_PATH     = '/ekonomi/';
const HTML_TIMEOUT  = 4000;   // ms — ağ yavaşsa cache'e düş

const STATIC_CACHE  = `bp-static-v${SW_VERSION}`;
const DYNAMIC_CACHE = `bp-dynamic-v${SW_VERSION}`;
const ASSET_CACHE   = `bp-assets-v${SW_VERSION}`;
const ALL_CACHES    = [STATIC_CACHE, DYNAMIC_CACHE, ASSET_CACHE];

/* Yalnızca çevrimdışı yedek olarak tutulacak yerel varlıklar */
const PRECACHE_LOCAL = [
  `${BASE_PATH}`,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`
];

/* CDN varlıkları — no-cors (opaque) olarak önbelleğe alınır.
   Ağ yoksa bile çalışsın diye. */
const PRECACHE_EXTERNAL = [
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js'
];

/* Asla cache'lenmeyecek origin'ler */
const API_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.google.com'
];

/* ─────────────────────────────────────────────
   YARDIMCILAR
───────────────────────────────────────────── */

/** Timeout'lu fetch — ağ yavaşsa cache'e düşmek için. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      res => { clearTimeout(timer); resolve(res); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Cache'e güvenli yazma — sessizce yutar. */
async function putSafely(cacheName, request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (e) {
    // Quota / CORS / benzeri — log'a gerek yok
  }
}

/** HTML mi? Kapsamlı tespit. */
function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  if (url.pathname === BASE_PATH) return true;
  if (url.pathname === `${BASE_PATH}index.html`) return true;
  if (url.pathname === '/ekonomi') return true;
  return false;
}

/** Statik asset mi? */
function isAssetRequest(request) {
  const d = request.destination;
  return d === 'style' || d === 'script' ||
         request.url.includes('.json') ||
         request.url.includes('.woff');
}

/** Görsel/font mu? */
function isMediaRequest(request) {
  const d = request.destination;
  return d === 'image' || d === 'font';
}

/** API host'larından biri mi? */
function isApiCall(url) {
  return API_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));
}

/* ─────────────────────────────────────────────
   INSTALL
───────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  console.log(`[SW v${SW_VERSION}] install`);

  event.waitUntil((async () => {
    try {
      /* Yerel varlıkları önbelleğe al (zorunlu) */
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(PRECACHE_LOCAL);

      /* CDN varlıkları — hata olsa da devam et */
      const assetCache = await caches.open(ASSET_CACHE);
      await Promise.all(
        PRECACHE_EXTERNAL.map(url =>
          assetCache.add(new Request(url, { mode: 'no-cors' }))
            .catch(err => console.warn('[SW] precache fail:', url, err?.message))
        )
      );

      /* Yeni SW'yi beklemeden devreye al */
      await self.skipWaiting();
      console.log(`[SW v${SW_VERSION}] installed & waiting skipped`);
    } catch (err) {
      console.error('[SW] install error:', err);
    }
  })());
});

/* ─────────────────────────────────────────────
   ACTIVATE
───────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  console.log(`[SW v${SW_VERSION}] activate`);

  event.waitUntil((async () => {
    /* Eski sürümlerin cache'lerini sil */
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => !ALL_CACHES.includes(k))
        .map(k => {
          console.log('[SW] deleting old cache:', k);
          return caches.delete(k);
        })
    );

    /* Açık sekmeleri de devral */
    await self.clients.claim();
    console.log(`[SW v${SW_VERSION}] activated & clients claimed`);
  })());
});

/* ─────────────────────────────────────────────
   FETCH
───────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* GET olmayan istekler → bypass */
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  /* API çağrıları → bypass */
  if (isApiCall(url)) return;

  /* ═══════════════════════════════════════
     HTML → NETWORK-FIRST + no-store + timeout
     ═══════════════════════════════════════ */
  if (isHtmlRequest(req, url)) {
    event.respondWith((async () => {
      try {
        /* no-store: tarayıcı HTTP cache'ini de atla */
        const fresh = await fetchWithTimeout(
          new Request(req, { cache: 'no-store' }),
          HTML_TIMEOUT
        );

        if (fresh && fresh.ok) {
          putSafely(STATIC_CACHE, req, fresh.clone());
          return fresh;
        }
        throw new Error(`HTTP ${fresh?.status}`);
      } catch (err) {
        /* Ağ yok veya timeout → cache'ten servis et */
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;

        /* Son çare: kök index.html */
        const fallback = await caches.match(`${BASE_PATH}index.html`);
        if (fallback) return fallback;

        return new Response(
          '<h1>Çevrimdışı</h1><p>Bağlantı yok ve yedek sayfa bulunamadı.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  /* ═══════════════════════════════════════
     STATİK ASSET → STALE-WHILE-REVALIDATE
     ═══════════════════════════════════════ */
  if (isAssetRequest(req)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);

      /* Arka planda güncelle */
      const networkPromise = fetch(req)
        .then(res => {
          putSafely(ASSET_CACHE, req, res.clone());
          return res;
        })
        .catch(() => null);

      /* Cache varsa anında dön, yoksa ağı bekle */
      if (cached) return cached;

      const fresh = await networkPromise;
      if (fresh) return fresh;

      return new Response('/* offline */', {
        status: 504,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
    return;
  }

  /* ═══════════════════════════════════════
     GÖRSEL / FONT → CACHE-FIRST
     ═══════════════════════════════════════ */
  if (isMediaRequest(req)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      try {
        const res = await fetch(req);
        putSafely(DYNAMIC_CACHE, req, res.clone());
        return res;
      } catch {
        /* Sessiz 204 — ikon kırık gösterme */
        return new Response(null, { status: 204 });
      }
    })());
    return;
  }

  /* ═══════════════════════════════════════
     DİĞER → NETWORK-FIRST + FALLBACK
     ═══════════════════════════════════════ */
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      putSafely(DYNAMIC_CACHE, req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;

      /* JSON isteği ise yapılandırılmış offline yanıt */
      const accept = req.headers.get('accept') || '';
      if (accept.includes('application/json')) {
        return new Response(
          JSON.stringify({ offline: true, message: 'Çevrimdışı mod' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('Çevrimdışı — kaynak bulunamadı', {
        status: 408,
        statusText: 'Request Timeout',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});

/* ─────────────────────────────────────────────
   BACKGROUND SYNC (destekleyen tarayıcılarda)
   iOS Safari periodicsync desteklemez.
───────────────────────────────────────────── */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'archive-check' && 'SyncManager' in self) {
    event.waitUntil(notifyClients({ type: 'PERIODIC_ARCHIVE_CHECK' }));
  }
});

async function notifyClients(payload) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ ...payload, timestamp: Date.now() }));
}

/* ─────────────────────────────────────────────
   PUSH NOTIFICATIONS
───────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try { data = event.data.json(); } catch { data = { title: 'Bütçem Pro', body: event.data.text() }; }

  const options = {
    body: data.body || 'Finansal durumunuzu kontrol edin',
    icon: `${BASE_PATH}icons/icon-192.png`,
    badge: `${BASE_PATH}icons/icon-96.png`,
    vibrate: [200, 100, 200],
    data: { url: data.url || BASE_PATH }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Bütçem Pro', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || BASE_PATH;

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.includes(BASE_PATH) && 'focus' in c) return c.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});

/* ─────────────────────────────────────────────
   MESSAGE HANDLING (sayfadan SW'ye komutlar)
───────────────────────────────────────────── */
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil((async () => {
      await Promise.all(ALL_CACHES.map(c => caches.delete(c)));
      console.log('[SW] all caches cleared');
      event.source?.postMessage({ type: 'CACHE_CLEARED' });
    })());
    return;
  }

  if (data.type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: SW_VERSION });
    return;
  }
});
