// Apresentação: abre rápido e funciona sem internet depois da primeira vez.
// Rede primeiro — uma versão nova aparece na hora; sem internet, usa a cópia guardada.
// O arquivo dados.palco é guardado como veio: trancado. A senha nunca passa por aqui.
const CACHE = "apresentacao-v1";
const CASCA = ["./", "./index.html", "./manifest.webmanifest", "./versao.json", "./marca/icone.svg", "./marca/icone-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n.startsWith("apresentacao-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.includes("/apresentacao/")) return;
  // versao.json?t= vira uma chave só; dados.palco?v= guarda só a versão atual
  const dados = url.pathname.endsWith("/dados.palco");
  const chave = new Request(url.origin + url.pathname + (dados ? url.search : ""));
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then(async (c) => {
            if (dados) for (const k of await c.keys()) if (k.url.includes("/dados.palco") && k.url !== chave.url) await c.delete(k);
            await c.put(chave, copia);
          }).catch(() => {});
        }
        return r;
      })
      .catch(() => caches.match(chave).then((r) => r || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
