// DEMANDA X: abre rápido e funciona sem internet com os últimos dados vistos.
// Rede primeiro — dado novo aparece na hora; sem internet, usa a cópia guardada.
const CACHE = "radar-demandax-v2";
const CASCA = ["./", "./index.html", "./manifest.webmanifest", "./marca/icone.svg", "./marca/icone-192.png", "./data/londrina.json", "./data/londrina-historico.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("radar-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.includes("/radar/")) return;
  const chave = new Request(url.origin + url.pathname);   // ignora ?t= do "Atualizar"
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copia = r.clone(); if (r.ok) caches.open(CACHE).then((c) => c.put(chave, copia)).catch(() => {}); return r; })
      .catch(() => caches.match(chave).then((r) => r || caches.match("./index.html")))
  );
});
