// Service worker: the app opens offline (weather data still needs to be online).
// When a new version is released, change the VERSION number: users will see an "Update" button.
const VERSION = '1.14.0';
const CACHE = 'fishing-web-' + VERSION;
const RUNTIME = 'fishing-runtime';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'data.js', 'fishx.js', 'countries.js', 'trx-it.js', 'trx-el.js', 'trx-sq.js', 'rules-data.js', 'trx-sl.js', 'trx-hr.js', 'trx-de.js', 'trx-es.js', 'trx-tr.js', 'i18n.js', 'model.js', 'api.js', 'dom.js', 'diary.js',
  'library.js', 'map.js', 'screens.js', 'bg.js', 'stats.js', 'app.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache: 'reload': bypass the browser cache, otherwise old files end up in the new version (Pages serves them with max-age=600)
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('fishing-web-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // APK, video background (Safari does not like video from a worker cache) and version.json are not cached
    if (url.pathname.includes('/downloads/') || url.pathname.endsWith('version.json') || /\.(apk|mp4)$/.test(url.pathname)) return;
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Leaflet (cdnjs) and fish photos (Wikimedia): from cache if present, and update in the background
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'upload.wikimedia.org') {
    e.respondWith(
      caches.open(RUNTIME).then(cache => cache.match(req).then(hit => {
        const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }))
    );
  }
  // everything else (weather, map, depths) goes straight to the network
});
