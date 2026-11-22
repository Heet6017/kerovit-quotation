// Offline helper for the installed app (Android "Install app" and the APK).
// - Pages: network first, so a new version is used as soon as it is published; the saved copy
//   is used only when there is no internet.
// - Program files carry a ?v= version stamp, so a cached copy is always the right one.
// - The price list (data/products.enc) stays encrypted; the newest copy is fetched when online.
const CACHE = "kq-v1";
const SHELL = ["./", "index.html", "manifest.webmanifest", "assets/logo-kerovit.png", "assets/logo-kajaria.png",
  "assets/icons/icon-192.png", "vendor/jszip.min.js", "vendor/jspdf.umd.min.js", "vendor/pdf.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const networkFirst = async (req) => {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req, { ignoreSearch: req.mode === "navigate" })) || (await c.match("index.html")) || Response.error();
  }
};
const cacheFirst = async (req) => {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
};

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // only this website's own files
  if (req.mode === "navigate" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("products.enc")) {
    e.respondWith(networkFirst(req));
  } else if (url.search.includes("v=") || /\/(assets|vendor|images)\//.test(url.pathname)) {
    e.respondWith(cacheFirst(req));                        // versioned program files, fonts, photos
  }
});
