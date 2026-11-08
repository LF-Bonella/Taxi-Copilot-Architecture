/**
 * Service Worker · Taxi Copilot Rio (PWA Nativo).
 * Estratégia Network-First com fallback offline para túneis e áreas de sombra no Rio.
 */
const CACHE_NAME = 'taxi-copilot-rio-v2';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => void 0),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Não intercepta APIs em tempo real (Supabase, OSRM, Open-Meteo, Nominatim)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('project-osrm.org') ||
    url.hostname.includes('open-meteo.com') ||
    url.hostname.includes('openstreetmap.org')
  ) {
    return;
  }

  // Para os recursos da própria aplicação: Network-First com fallback para Cache (ideal para túneis)
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html'))),
    );
  }
});
