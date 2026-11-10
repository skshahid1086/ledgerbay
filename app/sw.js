const CACHE = "ledgerbay-v21-19";
const FILES = [
  "./",
  "./index.html",
  "./index.css",
  "./theme.css",
  "./app.js",
  "./money.js",
  "./history-nav.js",
  "./features.js",
  "./books.js",
  "./invoice-themes.js",
  "./invoice-detail.js",
  "./txn-activity.js",
  "./scan.js",
  "./native-shell.js",
  "./sync.js",
  "./gstin.js",
  "./report-print.js",
  "./qr.js",
  "./vendor/zxing-browser.min.js",
  "./vendor/html2canvas.min.js",
  "./vendor/jspdf.umd.min.js",
  "./fonts/LiberationSans-Regular.ttf",
  "./fonts/LiberationSans-Bold.ttf",
  "./fonts/LiberationSerif-Bold.ttf",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match("./index.html")))
  );
});
