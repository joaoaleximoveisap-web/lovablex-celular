// ARMÁRIO: funciona por completo sem internet depois de instalado.
// Tudo do app (uma página só) fica guardado; as roupas ficam no IndexedDB do aparelho.
const CACHE = "armario-v1";
const CASCA = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./marca/icone.svg",
  "./marca/icone-192.png",
  "./marca/icone-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(CASCA.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("armario-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro para a casca (versão nova aparece na hora); sem internet, usa a cópia.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/armario/")) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r && r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
