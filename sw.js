/* Service worker do Financeiro: deixa o app instalável e abrindo rápido.
   Os dados NÃO ficam guardados aqui: eles sempre vêm do Supabase. */
const VERSAO = "fin-1.16.0";
const BASE = ["./", "./index.html", "./boot.js?v=1.16.0", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== "fin-share").map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  // "Compartilhar com o Finance" (Android): guarda o arquivo e o texto e abre o app
  if (req.method === "POST" && new URL(req.url).pathname.endsWith("/compartilhar")) {
    e.respondWith((async () => {
      try {
        const f = await req.formData(), c = await caches.open("fin-share");
        const texto = [f.get("title"), f.get("text"), f.get("url")].filter(Boolean).join("\n");
        await c.delete("compartilhado-texto"); await c.delete("compartilhado-arquivo");
        if (texto) await c.put("compartilhado-texto", new Response(texto));
        const arq = f.getAll("arquivo").find(x => x && x.size);
        if (arq) await c.put("compartilhado-arquivo", new Response(arq, { headers: { "content-type": arq.type || "application/octet-stream", "x-nome": encodeURIComponent(arq.name || "comprovante") } }));
      } catch (_) {}
      return Response.redirect(new URL("./?acao=compartilhado", self.registration.scope).href, 303);
    })());
    return;
  }
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

// Avisos de vencimento: chegam do servidor uma vez por dia
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Finance", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Finance", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    tag: d.tag || "finance", renotify: true, data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return clients.openWindow(url);
  }));
});
