// Offline support for the Overtime app: network first (so updates arrive), cached copy when offline.
const CACHE = 'overtime-v3';
const SHELL = [
  './', 'index.html', 'app.js', 'overtime.css', 'manifest.webmanifest',
  'form/unrostered-overtime-claim.pdf',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  '../styles.css', '../vendor/pdf-lib.min.js', '../vendor/qrcode.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('overtime-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
