// Offline copy so the app opens instantly in the car with no signal.
// Stale-while-revalidate: serve the cached copy, refresh it in the background; updates show on the next launch.
const CACHE = "clb-v2";
const FILES = ["./", "index.html", "app.js", "protocol.js", "looks.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request)
      .then(r => { if (r.ok || r.type === "opaque") cache.put(e.request, r.clone()); return r; }) // also keeps Google Fonts offline
      .catch(() => cached);
    return cached || fresh;
  }));
});
