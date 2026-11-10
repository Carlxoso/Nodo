// Service Worker de NODO ciudadano: la app abre sin internet.
// Estrategia: red primero (así los cambios llegan), caché como respaldo. La API nunca se cachea.
const CACHE = 'nodo-ciudadano-v12';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'recorrido.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  '/compartido/base.css', '/compartido/carga.css', '/compartido/carga.js', '/compartido/logo.svg', '/compartido/iconos.svg', '/compartido/iconos-solidos.svg',
  ...['400', '500', '600', '700'].map((w) => `/compartido/fuentes/ibm-plex-sans-latin-${w}-normal.woff2`),
  ...['500', '600', '700'].map((w) => `/compartido/fuentes/ibm-plex-sans-condensed-latin-${w}-normal.woff2`)];

self.addEventListener('install', (e) => {
  // Cada archivo por separado: si falta uno (p. ej. una fuente), los demás se guardan igual
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  const propio = url.pathname.startsWith('/ciudadano/') || url.pathname.startsWith('/compartido/') || url.pathname.startsWith('/vendor/leaflet/');
  if (req.method !== 'GET' || url.origin !== location.origin || !propio) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./')))
  );
});
