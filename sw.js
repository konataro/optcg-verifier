/* ============================================================
  Service Worker de OPTCG Verifier
  ============================================================
  Estrategias (prudentes y con memoria acotada):
   · Navegaciones (HTML): network-first, respaldo en caché →
     la app es usable sin red y siempre se actualiza online.
   · App shell + catálogo (JS/CSS/manifest/catalog.json/iconos):
     stale-while-revalidate → al toque del caché + refresco silecioso.
   · Imágenes de cartas: cache-first en caché aparte con tope de
     300 entradas → poca red, poco almacenamiento.
   · Precios (API POST/GET externo): nunca se cachea aquí (ya hay
     caché IndexedDB de 24h a nivel app).

  Para actualizar la app: subí estos archivos y CAMBIÉ VERSION.
  ============================================================ */

const VERSION = "v1.0.0";
const SHELL_CACHE = `opcg-shell-${VERSION}`;
const IMG_CACHE = "opcg-imgs";
const IMG_LIMIT = 300;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/catalog.js",
  "./js/ocr.js",
  "./js/scanner.js",
  "./js/prices.js",
  "./js/db.js",
  "./js/pwa.js",
  "./data/catalog.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll en bloques: si el catálogo falla, no tira toda la instalación
      try {
        await cache.addAll(SHELL_ASSETS);
      } catch (e) {
        console.warn("[SW] precache parcial:", e);
      }
      // activación inmediata: solo reemplaza cuando el usuario recarga
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // limpia cachés de versiones anteriores
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("opcg-shell-") && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // precios u otras POSTs pasan directo

  const url = new URL(req.url);

  // 1) navegar: network first → caché → index offline
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const c = await caches.open(SHELL_CACHE);
          c.put("./index.html", fresh.clone());
          return fresh;
        } catch {
          return (
            (await caches.match(req)) ||
            (await caches.match("./index.html")) ||
            Response.error()
          );
        }
      })()
    );
    return;
  }

  // 2) imagenes de la app e iconos own-origin: swr del shell
  // 3) imagenes de cartas (CORS/opaque): cache-first acotado
  const isImage = req.destination === "image";
  const isOwn = url.origin === self.location.origin;

  if (isImage && !isOwn) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req, { cacheName: IMG_CACHE });
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(IMG_CACHE);
            cache.put(req, fresh.clone());
            trimCache(IMG_CACHE, IMG_LIMIT);
          }
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 4) resto del app shell: stale-while-revalidate
  if (isOwn || url.origin === "https://cdn.jsdelivr.net") {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) {
              caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          network.catch(() => {}); // evita unhandled rejection
          return cached;
        }
        const res = await network;
        if (res) return res;
        return (await caches.match("./index.html")) || Response.error();
      })()
    );
  }
});

/** acota la caché de imágenes (FIFO simple) */
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  for (const k of keys.slice(0, keys.length - max)) {
    await cache.delete(k);
  }
}
