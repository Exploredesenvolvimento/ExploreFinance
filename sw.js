/* Service worker do Financeiro: deixa o app instalável e abrindo rápido.
   Os dados NÃO ficam guardados aqui: eles sempre vêm do Supabase. */
const VERSAO = "fin-1.8.2";
const BASE = ["./", "./index.html", "./boot.js?v=1.8.2", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("supabase.in")) return; // dados: sempre da internet
  if (url.pathname.endsWith("/config.js")) return; // configuração: sempre a mais nova
  // página: tenta a internet primeiro, usa a cópia se estiver sem sinal
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSAO).then(c => c.put("./index.html", cp)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // bibliotecas com versão fixa e arquivos do app: usa a cópia e atualiza em segundo plano
  const cdn = /(^|\.)(jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (cdn || url.origin === self.location.origin) {
    e.respondWith(caches.open(VERSAO).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
