// Doorway Field v2.0 — service worker: app shell offline (cache-first), viewed map tiles cached at runtime (capped),
// API calls never cached. Background Sync (Android/Chrome only) just asks the open page to flush; iPhone flushes on open.
const SHELL = 'df-shell-2.4.3';
const TILES = 'df-tiles-1';
const TILE_CAP = 3000;   // viewed tiles only (re-panning turf = 0 data); no bulk pre-download (OpenFreeMap / Esri terms). Google tiles: browser HTTP cache only (Google terms)
let puts = 0;
const ASSETS = ['./', 'index.html', 'styles.css', 'styles-v2.css', 'config.public.js', 'app.js', 'OfflineSync.js', 'MapEngine.js', 'MapTools.js', 'BottomCard.js', 'FilterDrawer.js',
  'LassoSheet.js', 'ListView.js', 'StatsView.js', 'LeadImport.js', 'AdminPanel.js', 'PinStudio.js', 'TurfZones.js', 'Pwa.js', 'manifest.webmanifest', 'icon.svg',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
const TILE_HOSTS = ['server.arcgisonline.com', 'basemap.nationalmap.gov', 'tiles.openfreemap.org'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - TILE_CAP; i++) await cache.delete(keys[i]);
}
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                                   // API POSTs go straight to the network
  if (TILE_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); if (++puts % 50 === 0) trim(c); }   // trim every 50 writes, not every tile
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  if (url.origin === location.origin && url.pathname.endsWith('/config.env.js')) {      // endpoints: network-first so a changed Sync URL applies at once
    e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(SHELL).then(c => c.put(req, res.clone())); return res; }).catch(() => caches.match(req)));
    return;
  }
  if (url.origin === location.origin || url.hostname === 'unpkg.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && url.origin === location.origin) caches.open(SHELL).then(c => c.put(req, res.clone()));
      return res;
    })).catch(() => caches.match('index.html')));
  }
});
self.addEventListener('sync', e => {
  if (e.tag === 'df-flush') e.waitUntil(self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage('df-flush'))));
});
