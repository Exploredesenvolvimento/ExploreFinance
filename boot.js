/* Financeiro · versão hospedada
   Login, empresas, equipe e a ponte entre o app e o Supabase.
   O app conversa com window.claude.use("db"), igual à versão no Claude;
   aqui essa peça passa a falar com o Supabase. */
(() => {
"use strict";
const CFG = window.FIN_CONFIG || {};
const LS = { get(k){try{return localStorage.getItem(k);}catch(_){return null;}}, set(k,v){try{localStorage.setItem(k,v);}catch(_){}}, del(k){try{localStorage.removeItem(k);}catch(_){}} };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PAPEL = { dono: "Dono", editor: "Pode editar", leitor: "Só visualiza" };
const FIN = window.FIN = { sb:null, user:null, empresas:[], empresa:null, papel:null, team:null, installEvt:null };

let resolveDb; const dbReady = new Promise(r => resolveDb = r);
const userShim = {
  async can(what){ await dbReady; return what === "data.write" ? FIN.papel !== "leitor" : null; },
  isOwner(){ return FIN.papel === "dono"; }, canEdit(){ return FIN.papel === "dono"; },
  async id(){ return FIN.user && FIN.user.id; }
};
const dlShim = { async save({ filename, data }){
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { status: "saved" };
} };
/* Anexos: bucket privado "anexos" no Supabase Storage, uma pasta por empresa.
   O id guardado no lançamento é o caminho do arquivo; para abrir, o app pede um link temporário. */
const extDe = t => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" })[t] || "bin";
const urlCache = new Map();
const assetsShim = {
  async upload(file, opt){
    await dbReady; if (FIN.papel === "leitor") throw { code: "not_granted" };
    const type = (opt && opt.type) || file.type;
    if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(type)) throw { code: "unsupported_type" };
    if (file.size > 10485760) throw { code: "too_large" };
    const rnd = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const path = FIN.empresa.id + "/" + rnd + "." + extDe(type);
    const { error } = await FIN.sb.storage.from("anexos").upload(path, file, { contentType: type, upsert: false });
    if (error) throw { code: /row-level|403|Unauthorized/i.test(error.message + error.code) ? "not_granted" : /size|413/i.test(error.message + error.code) ? "too_large" : /mime|415/i.test(error.message + error.code) ? "unsupported_type" : "upstream_error", message: error.message };
    return { id: path, url: "", sizeBytes: file.size, contentType: type };
  },
  async delete(path){ await dbReady; urlCache.delete(path); const { data } = await FIN.sb.storage.from("anexos").remove([path]); return { deleted: !!(data && data.length) }; },
  async urlFor(path){
    await dbReady; const c = urlCache.get(path); if (c && c.ate > Date.now()) return c.url;
    const { data, error } = await FIN.sb.storage.from("anexos").createSignedUrl(path, 3600);
    if (error) throw error; urlCache.set(path, { url: data.signedUrl, ate: Date.now() + 3300e3 }); return data.signedUrl;
  }
};
window.claude = { use: async n => n === "db" ? dbReady : n === "user" ? userShim : n === "downloads" ? dlShim : n === "assets" ? (await dbReady, assetsShim) : null };

/* ---------- tela cheia de login / empresa ---------- */
const root = document.createElement("div"); root.id = "authRoot"; document.body.appendChild(root);
function screen(inner){ root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-brand"><span class="auth-ic">F</span><div><b>Financeiro</b><small>Contas, cartões e orçamento num lugar só</small></div></div>${inner}</div></div>`; root.hidden = false; const f = root.querySelector("input"); f && f.focus(); }
function msg(t, kind){ const m = root.querySelector(".auth-msg"); if(m){ m.textContent = t; m.className = "auth-msg " + (kind || ""); m.hidden = !t; } }
function busy(btn, on, txt){ if(!btn) return; btn.disabled = on; if(txt) btn.textContent = txt; }
const traduz = e => {
  const m = String(e && (e.message || e.error_description || e) || "");
  if (/Invalid login credentials/i.test(m)) return "E-mail ou senha incorretos.";
  if (/Email not confirmed/i.test(m)) return "Confirme seu e-mail primeiro. Procure a mensagem do Supabase na caixa de entrada ou no spam.";
  if (/already registered|already been registered/i.test(m)) return "Este e-mail já tem conta. Use Entrar ou Esqueci minha senha.";
  if (/at least 6|Password should/i.test(m)) return "A senha precisa ter pelo menos 6 caracteres.";
  if (/rate limit|security purposes|too many/i.test(m)) return "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.";
  if (/valid email|invalid email|Unable to validate email/i.test(m)) return "Confira o e-mail digitado.";
  if (/limite_empresas/.test(m)) return "Você chegou ao limite de 10 empresas.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "Sem conexão. Confira a internet e tente de novo.";
  return "Não deu certo: " + m;
};

function telaEntrar(modo){
  modo = modo || "entrar";
  const t = { entrar: ["Entrar", "Entrar"], criar: ["Criar conta", "Criar minha conta"], esqueci: ["Recuperar senha", "Enviar link"] }[modo];
  screen(`<h2 class="auth-h">${t[0]}</h2>
    <form id="authForm" class="auth-form" novalidate>
      <label>E-mail<input id="au_email" type="email" autocomplete="email" inputmode="email" required></label>
      ${modo !== "esqueci" ? `<label>Senha<input id="au_senha" type="password" autocomplete="${modo === "criar" ? "new-password" : "current-password"}" minlength="6" required>${modo === "criar" ? '<span class="auth-help">Pelo menos 6 caracteres.</span>' : ""}</label>` : `<p class="auth-help">Vamos mandar um link para você criar uma senha nova.</p>`}
      <div class="auth-msg" hidden></div>
      <button class="btn primary auth-go" type="submit">${t[1]}</button>
    </form>
    <div class="auth-links">
      ${modo !== "entrar" ? `<button data-m="entrar">Já tenho conta</button>` : `<button data-m="criar">Criar conta</button><button data-m="esqueci">Esqueci minha senha</button>`}
    </div>`);
  root.querySelectorAll("[data-m]").forEach(b => b.onclick = () => telaEntrar(b.dataset.m));
  root.querySelector("#authForm").onsubmit = async ev => {
    ev.preventDefault();
    const email = root.querySelector("#au_email").value.trim().toLowerCase(), s = root.querySelector("#au_senha"), senha = s ? s.value : "";
    const btn = root.querySelector(".auth-go");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("Confira o e-mail digitado.", "err");
    if (modo !== "esqueci" && senha.length < 6) return msg("A senha precisa ter pelo menos 6 caracteres.", "err");
    busy(btn, true, "Aguarde...");
    try {
      const back = location.origin + location.pathname;
      if (modo === "entrar") { const { error } = await FIN.sb.auth.signInWithPassword({ email, password: senha }); if (error) throw error; return iniciar(); }
      else if (modo === "criar") {
        const { data, error } = await FIN.sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: back } });
        if (error) throw error;
        if (data.session) return iniciar();
        if (!data.session) { screen(`<h2 class="auth-h">Confirme seu e-mail</h2><p class="auth-p">Mandamos um link para <b>${esc(email)}</b>. Clique nele para ativar a conta e depois volte aqui para entrar.</p><p class="auth-help">Não chegou? Olhe a pasta de spam. Pode levar alguns minutos.</p><div class="auth-links"><button data-m="entrar">Voltar para entrar</button></div>`); root.querySelector("[data-m]").onclick = () => telaEntrar("entrar"); return; }
      } else {
        const { error } = await FIN.sb.auth.resetPasswordForEmail(email, { redirectTo: back }); if (error) throw error;
        msg("Pronto. Se esse e-mail tiver conta, o link chega em alguns minutos.", "ok"); busy(btn, false, "Enviar link"); return;
      }
    } catch (e) { msg(traduz(e), "err"); busy(btn, false, t[1]); }
  };
}
function telaNovaSenha(){
  screen(`<h2 class="auth-h">Crie uma senha nova</h2><form id="pwForm" class="auth-form" novalidate>
    <label>Senha nova<input id="pw1" type="password" autocomplete="new-password" minlength="6"></label>
    <label>Repita a senha<input id="pw2" type="password" autocomplete="new-password" minlength="6"></label>
    <div class="auth-msg" hidden></div><button class="btn primary auth-go" type="submit">Salvar senha</button></form>`);
  root.querySelector("#pwForm").onsubmit = async ev => {
    ev.preventDefault(); const a = root.querySelector("#pw1").value, b = root.querySelector("#pw2").value;
    if (a.length < 6) return msg("A senha precisa ter pelo menos 6 caracteres.", "err");
    if (a !== b) return msg("As duas senhas não são iguais.", "err");
    const { error } = await FIN.sb.auth.updateUser({ password: a });
    if (error) return msg(traduz(error), "err");
    history.replaceState(null, "", location.pathname); iniciar();
  };
}
function telaCriarEmpresa(primeira){
  let modo = "";
  screen(`<h2 class="auth-h">${primeira ? "Vamos começar" : "Novo espaço"}</h2>
    <p class="auth-p">${primeira ? "Cada espaço tem os dados separados. Depois você pode convidar outras pessoas." : "Ele começa vazio, com os dados separados dos outros."}</p>
    <form id="emForm" class="auth-form" novalidate>
      <div class="auth-modo" role="group" aria-label="Para que vai usar"><button type="button" data-modo="pessoal"><b>Pessoal ou família</b><small>Contas da casa e orçamento</small></button><button type="button" data-modo="empresa"><b>Empresa</b><small>Contas a pagar e a receber</small></button></div>
      <label><span id="em_lbl">Nome</span><input id="em_nome" maxlength="80" placeholder="Escolha uma das opções acima"></label>
    <div class="auth-msg" hidden></div><button class="btn primary auth-go" type="submit">Começar</button></form>
    <div class="auth-links">${primeira ? `<button id="emSair">Sair</button>` : `<button id="emVoltar">Voltar</button>`}</div>`);
  const sair = root.querySelector("#emSair"), voltar = root.querySelector("#emVoltar");
  if (sair) sair.onclick = sairConta; if (voltar) voltar.onclick = () => { root.hidden = true; };
  root.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => {
    modo = b.dataset.modo; root.querySelectorAll("[data-modo]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    root.querySelector("#em_lbl").textContent = modo === "pessoal" ? "Nome deste espaço" : "Nome da empresa";
    root.querySelector("#em_nome").placeholder = modo === "pessoal" ? "Ex.: Casa da família Duque" : "Ex.: EXPLORE Desenvolvimento";
    root.querySelector("#em_nome").focus(); msg("");
  });
  root.querySelector("#emForm").onsubmit = async ev => {
    ev.preventDefault(); const nome = root.querySelector("#em_nome").value.trim(); const btn = root.querySelector(".auth-go");
    if (!modo) return msg("Escolha se é para uso pessoal ou de empresa.", "err");
    if (!nome) return msg(modo === "pessoal" ? "Dê um nome para este espaço." : "Digite o nome da empresa.", "err");
    busy(btn, true, "Criando...");
    const { data, error } = await FIN.sb.rpc("criar_empresa", { p_nome: nome });
    if (error) { busy(btn, false, "Começar"); return msg(traduz(error), "err"); }
    LS.set("fin.empresa", data); LS.set("fin.modo." + data, modo); location.reload();
  };
}
FIN.consumirModo = () => { if (!FIN.empresa) return null; const k = "fin.modo." + FIN.empresa.id, m = LS.get(k); LS.del(k); return m; };
async function sairConta(){ await FIN.sb.auth.signOut(); LS.del("fin.empresa"); location.reload(); }

/* ---------- conta, empresas e instalação ---------- */
function abrirConta(){
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  const instalado = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const m = document.getElementById("modalRoot");
  m.innerHTML = `<div class="overlay"><div class="sheet" role="dialog" aria-modal="true">
    <div class="hd"><h3>Sua conta</h3><button class="btn ghost small" data-x aria-label="Fechar">&times;</button></div>
    <p style="margin:0;color:var(--muted);font-size:14px">Entrou como <b style="color:var(--fg)">${esc(FIN.user.email)}</b></p>
    <div><h2 style="margin-bottom:8px">Empresas</h2><div class="rows">${FIN.empresas.map(e => `<button class="emp-row ${e.id === FIN.empresa.id ? "on" : ""}" data-emp="${e.id}"><b>${esc(e.nome)}</b><span>${PAPEL[e.papel]}</span></button>`).join("")}</div>
      <div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn small" data-nova>+ Novo espaço</button></div></div>
    ${instalado ? "" : `<div class="note"><b>Instalar no celular ou computador</b><br>${FIN.installEvt ? `Coloque o Financeiro na tela inicial, com ícone próprio.<div style="margin-top:8px"><button class="btn primary small" data-inst>Instalar o app</button></div>` : ios ? "No iPhone: toque no botão Compartilhar do Safari (o quadrado com a seta) e depois em <b>Adicionar à Tela de Início</b>." : "No Chrome do Android: menu de três pontinhos e <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>."}</div>`}
    <div class="actions"><button class="btn danger" data-sair>Sair da conta</button></div></div></div>`;
  const close = () => { m.innerHTML = ""; };
  m.querySelector(".overlay").addEventListener("click", ev => {
    if (ev.target.classList.contains("overlay") || ev.target.closest("[data-x]")) return close();
    const emp = ev.target.closest("[data-emp]"); if (emp) { if (emp.dataset.emp !== FIN.empresa.id) { LS.set("fin.empresa", emp.dataset.emp); location.reload(); } else close(); return; }
    if (ev.target.closest("[data-nova]")) { close(); telaCriarEmpresa(false); return; }
    if (ev.target.closest("[data-sair]")) { sairConta(); return; }
    if (ev.target.closest("[data-inst]") && FIN.installEvt) { FIN.installEvt.prompt(); FIN.installEvt.userChoice.finally(() => { FIN.installEvt = null; close(); }); }
  });
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); FIN.installEvt = e; });

/* ---------- equipe (aparece na aba Ajustes) ---------- */
FIN.ajustesHTML = () => {
  const dono = FIN.papel === "dono", t = FIN.team;
  if (!t) { FIN.loadTeam(); return `<div class="set"><div><h3>Empresa e equipe</h3></div><div class="muted">Carregando...</div></div>`; }
  return `<div class="set" id="equipe"><div><h3>Empresa e equipe</h3><p>Quem tem acesso a esta empresa e o que cada pessoa pode fazer.</p></div><div>
    ${dono ? `<div class="form" style="margin:12px 0"><label class="f full">Nome da empresa<span style="display:flex;gap:8px"><input id="eq_nome" value="${esc(FIN.empresa.nome)}" maxlength="80"><button class="btn small" data-eq="renomear">Salvar nome</button></span></label></div>` : `<p style="color:var(--muted);margin:.3em 0 12px">${esc(FIN.empresa.nome)} · você ${FIN.papel === "editor" ? "pode editar" : "só visualiza"}</p>`}
    <div class="panel">${t.membros.map(mb => `<div class="mem"><div style="min-width:0"><b>${esc(mb.email)}${mb.user_id === FIN.user.id ? " (você)" : ""}</b><span>${PAPEL[mb.papel]}</span></div>
      ${dono && mb.papel !== "dono" ? `<select data-eqpapel="${mb.user_id}" aria-label="Papel"><option value="editor" ${mb.papel === "editor" ? "selected" : ""}>Pode editar</option><option value="leitor" ${mb.papel === "leitor" ? "selected" : ""}>Só visualiza</option></select><button class="btn ghost small" data-eq="remover" data-uid="${mb.user_id}">Remover</button>` : ""}
      ${!dono && mb.user_id === FIN.user.id ? `<button class="btn ghost small" data-eq="deixar">Sair desta empresa</button>` : ""}</div>`).join("")}
      ${t.convites.map(c => `<div class="mem pend"><div style="min-width:0"><b>${esc(c.email)}</b><span>Convite pendente · ${PAPEL[c.papel]}</span></div>${dono ? `<button class="btn ghost small" data-eq="cancelar" data-email="${esc(c.email)}">Cancelar</button>` : ""}</div>`).join("")}</div>
    ${dono ? `<div class="form" style="margin-top:14px"><label class="f">Convidar pelo e-mail<input id="eq_email" type="email" placeholder="nome@empresa.com"></label>
      <label class="f">Permissão<select id="eq_papel"><option value="editor">Pode editar</option><option value="leitor">Só visualiza</option></select></label></div>
      <div class="actions" style="justify-content:flex-start;margin-top:10px"><button class="btn primary small" data-eq="convidar">Convidar</button></div>
      <p style="font-size:13px;color:var(--muted);margin:.8em 0 0">A pessoa não recebe e-mail automático. Mande o link do app para ela e peça para criar a conta com <b>esse mesmo e-mail</b>. O acesso libera quando ela entrar.</p>` : ""}
  </div></div>`;
};
FIN.loadTeam = async () => {
  if (FIN._loadingTeam) return; FIN._loadingTeam = true;
  const e = FIN.empresa.id;
  const [m, c] = await Promise.all([
    FIN.sb.from("membros").select("user_id,email,papel").eq("empresa_id", e).order("criado_em"),
    FIN.papel === "dono" ? FIN.sb.from("convites").select("email,papel").eq("empresa_id", e).order("criado_em") : Promise.resolve({ data: [] })
  ]);
  FIN.team = { membros: m.data || [], convites: c.data || [] }; FIN._loadingTeam = false;
  if (window.__finRender && document.querySelector('nav.tabs [data-tab="ajustes"][aria-selected="true"]')) window.__finRender();
};
function aviso(t){ document.querySelectorAll(".toast").forEach(x => x.remove()); const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2800); }
document.addEventListener("change", async ev => {
  const s = ev.target.closest("[data-eqpapel]"); if (!s) return;
  const { error } = await FIN.sb.from("membros").update({ papel: s.value }).eq("empresa_id", FIN.empresa.id).eq("user_id", s.dataset.eqpapel);
  aviso(error ? "Não foi possível mudar a permissão" : "Permissão atualizada"); FIN.team = null; FIN.loadTeam();
});
document.addEventListener("click", async ev => {
  if (ev.target.closest("#empBtn")) { abrirConta(); return; }
  const b = ev.target.closest("[data-eq]"); if (!b) return;
  const e = FIN.empresa.id, a = b.dataset.eq; let r = {};
  if (a === "convidar") {
    const email = document.getElementById("eq_email").value.trim().toLowerCase(), papel = document.getElementById("eq_papel").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return aviso("Confira o e-mail");
    if (FIN.team.membros.some(m => m.email === email)) return aviso("Essa pessoa já faz parte da empresa");
    r = await FIN.sb.from("convites").insert({ empresa_id: e, email, papel, convidado_por: FIN.user.id });
    if (r.error && r.error.code === "23505") { aviso("Essa pessoa já foi convidada"); r = {}; }
    else aviso(r.error ? "Não foi possível convidar" : "Convite criado. Avise a pessoa para criar a conta com " + email);
  } else if (a === "cancelar") { r = await FIN.sb.from("convites").delete().eq("empresa_id", e).eq("email", b.dataset.email); aviso("Convite cancelado"); }
  else if (a === "remover") {
    if (b.dataset.ok !== "1") { b.dataset.ok = "1"; b.textContent = "Confirmar remoção"; b.classList.add("danger"); return; }
    r = await FIN.sb.from("membros").delete().eq("empresa_id", e).eq("user_id", b.dataset.uid); aviso("Pessoa removida");
  } else if (a === "deixar") {
    if (b.dataset.ok !== "1") { b.dataset.ok = "1"; b.textContent = "Confirmar saída"; b.classList.add("danger"); return; }
    await FIN.sb.from("membros").delete().eq("empresa_id", e).eq("user_id", FIN.user.id); LS.del("fin.empresa"); location.reload(); return;
  } else if (a === "renomear") {
    const nome = document.getElementById("eq_nome").value.trim(); if (!nome) return aviso("Digite o nome");
    r = await FIN.sb.from("empresas").update({ nome }).eq("id", e);
    if (!r.error) { FIN.empresa.nome = nome; const eb = document.getElementById("empNome"); if (eb) eb.textContent = nome; document.title = nome + " · Financeiro"; aviso("Nome salvo"); }
  }
  if (r && r.error) aviso("Não deu certo. Tente de novo.");
  FIN.team = null; FIN.loadTeam();
});

/* ---------- a ponte com o banco (mesma interface do app) ---------- */
function makeDb(sb, emp){
  const cache = new Map(), loaded = new Map(), colSubs = new Map(), docSubs = new Map(); let pending = 0;
  const colOf = p => p.split("/")[0];
  const err = (code, message) => ({ code, message });
  const mapErr = e => { const m = String(e && e.message || ""), c = e && e.code;
    if (c === "42501" || c === "P0002" || /row-level security|doc_nao_existe|violates check/i.test(m)) return err("invalid_argument", m);
    if (/Failed to fetch|NetworkError|network/i.test(m)) return err("unavailable", m);
    return err("unavailable", m || "erro"); };
  const snapDoc = (path, data) => ({ id: path.split("/").pop(), exists: data !== undefined, data: () => data, metadata: { fromCache: false, hasPendingWrites: pending > 0 } });
  function emitCol(col){ const fns = colSubs.get(col); if (!fns || !loaded.get(col)) return;
    const docs = [...cache].filter(([p]) => colOf(p) === col).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([p, d]) => snapDoc(p, d));
    const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: pending > 0 } };
    fns.forEach(f => { try { f(snap); } catch (x) { console.error(x); } }); }
  function emitDoc(path){ const fns = docSubs.get(path); if (!fns || !loaded.get(colOf(path))) return; const s = snapDoc(path, cache.get(path)); fns.forEach(f => { try { f(s); } catch (x) { console.error(x); } }); }
  const emit = path => { emitCol(colOf(path)); emitDoc(path); };
  async function load(col){
    let from = 0, all = []; const step = 1000;
    for (;;) { const { data, error } = await sb.from("docs").select("path,data").eq("empresa_id", emp).eq("col", col).order("path").range(from, from + step - 1);
      if (error) throw mapErr(error); all = all.concat(data); if (data.length < step) break; from += step; }
    if (pending > 0) return false;
    let changed = !loaded.get(col);
    const seen = new Set(all.map(r => r.path));
    for (const [p] of cache) if (colOf(p) === col && !seen.has(p)) { cache.delete(p); changed = true; }
    for (const r of all) { const old = cache.get(r.path); if (!old || JSON.stringify(old) !== JSON.stringify(r.data)) { cache.set(r.path, r.data); changed = true; } }
    loaded.set(col, true); return changed;
  }
  async function ensure(col, onErr){ if (loaded.get(col) || loaded.get(col) === 0) return; loaded.set(col, 0);
    try { await load(col); emitCol(col); [...docSubs.keys()].filter(p => colOf(p) === col).forEach(emitDoc); }
    catch (e) { loaded.delete(col); onErr && onErr(e); } }
  /* Busca todas as coleções antes de avisar o app, e avisa recorrentes e configuração antes dos lançamentos:
     assim o app nunca vê os meses apagados de uma recorrente que, para ele, ainda existe. */
  async function refresh(){ if (document.hidden || pending > 0) return;
    const mudou = [];
    for (const col of [...loaded.keys()].filter(c => loaded.get(c) === true)) { try { if (await load(col)) mudou.push(col); } catch (_) {} }
    mudou.sort((a, b) => (a === "lancamentos") - (b === "lancamentos"))
      .forEach(col => { emitCol(col); [...docSubs.keys()].filter(p => colOf(p) === col).forEach(emitDoc); }); }
  setInterval(refresh, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("focus", refresh);
  try {
    sb.channel("docs-" + emp)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "docs", filter: "empresa_id=eq." + emp }, p => onRow(p.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "docs", filter: "empresa_id=eq." + emp }, p => onRow(p.new))
      .subscribe();
  } catch (_) {}
  function onRow(r){ if (!r || r.empresa_id !== emp || pending > 0) return; const old = cache.get(r.path);
    if (old && JSON.stringify(old) === JSON.stringify(r.data)) return; cache.set(r.path, r.data); emit(r.path); }
  async function write(path, fn, revert){ pending++; emit(path);
    try { await fn(); } catch (e) { revert(); throw e; } finally { pending--; emit(path); } }
  function docRef(path){
    if (path.split("/").length !== 2) throw new TypeError("caminho inválido: " + path);
    const col = colOf(path);
    return { id: path.split("/")[1], path,
      async get(){ await ensure(col); return snapDoc(path, cache.get(path)); },
      async set(data){ const before = cache.get(path), body = JSON.parse(JSON.stringify(data)); cache.set(path, body);
        await write(path, async () => { const { error } = await sb.from("docs").upsert({ empresa_id: emp, path, col, data: body }); if (error) throw mapErr(error); }, () => before === undefined ? cache.delete(path) : cache.set(path, before)); },
      async update(patch){ const before = cache.get(path), body = JSON.parse(JSON.stringify(patch));
        if (before) cache.set(path, { ...before, ...body });
        await write(path, async () => { const { error } = await sb.rpc("doc_merge", { p_empresa: emp, p_path: path, p_patch: body }); if (error) throw mapErr(error); }, () => before === undefined ? cache.delete(path) : cache.set(path, before)); },
      async delete(){ const before = cache.get(path); cache.delete(path);
        await write(path, async () => { const { error } = await sb.from("docs").delete().eq("empresa_id", emp).eq("path", path); if (error) throw mapErr(error); }, () => before !== undefined && cache.set(path, before)); },
      onSnapshot(next, onErr){ if (!docSubs.has(path)) docSubs.set(path, new Set()); docSubs.get(path).add(next);
        if (loaded.get(col) === true) setTimeout(() => next(snapDoc(path, cache.get(path))), 0); else ensure(col, onErr);
        return () => docSubs.get(path).delete(next); },
      collection(){ throw new TypeError("subcoleções não são usadas"); } };
  }
  const colRef = col => ({ path: col,
    doc: id => docRef(col + "/" + (id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)))),
    async add(d){ const r = this.doc(); await r.set(d); return r; },
    onSnapshot(next, onErr){ if (!colSubs.has(col)) colSubs.set(col, new Set()); colSubs.get(col).add(next);
      if (loaded.get(col) === true) setTimeout(() => emitCol(col), 0); else ensure(col, onErr);
      return () => colSubs.get(col).delete(next); },
    async get(){ await ensure(col); const docs = [...cache].filter(([p]) => colOf(p) === col).map(([p, d]) => snapDoc(p, d)); return { docs, size: docs.length, empty: !docs.length }; } });
  return { doc: docRef, collection: colRef };
}

/* ---------- início ---------- */
async function iniciar(){
  if (!CFG.url || !CFG.key || !window.supabase) { screen(`<h2 class="auth-h">Falta configurar</h2><p class="auth-p">Preencha o endereço e a chave pública do Supabase no arquivo <b>config.js</b> e publique de novo.</p>`); return; }
  if (!FIN.sb) {
    FIN.sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    FIN.sb.auth.onAuthStateChange((evt) => { if (evt === "PASSWORD_RECOVERY") telaNovaSenha(); if (evt === "SIGNED_OUT" && FIN.user) location.reload(); });
  }
  if (/type=recovery/.test(location.hash)) return; // a tela de senha nova abre pelo evento acima
  const { data: { session } } = await FIN.sb.auth.getSession();
  if (!session) return telaEntrar("entrar");
  FIN.user = session.user;
  await FIN.sb.rpc("aceitar_convites");
  const { data: ms, error } = await FIN.sb.from("membros").select("papel, empresas(id,nome)").eq("user_id", FIN.user.id);
  if (error) { screen(`<h2 class="auth-h">Não foi possível abrir</h2><p class="auth-p">${esc(traduz(error))}</p><div class="auth-links"><button onclick="location.reload()">Tentar de novo</button></div>`); return; }
  FIN.empresas = (ms || []).filter(m => m.empresas).map(m => ({ id: m.empresas.id, nome: m.empresas.nome, papel: m.papel })).sort((a, b) => a.nome.localeCompare(b.nome));
  if (!FIN.empresas.length) return telaCriarEmpresa(true);
  FIN.empresa = FIN.empresas.find(e => e.id === LS.get("fin.empresa")) || FIN.empresas[0];
  LS.set("fin.empresa", FIN.empresa.id); FIN.papel = FIN.empresa.papel;
  const nm = document.getElementById("empNome"); if (nm) nm.textContent = FIN.empresa.nome;
  const ic = document.getElementById("empIc"); if (ic) ic.textContent = FIN.empresa.nome.replace(/[^A-Za-zÀ-ÿ0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "F";
  document.title = FIN.empresa.nome + " · Financeiro";
  root.hidden = true; root.innerHTML = "";
  resolveDb(makeDb(FIN.sb, FIN.empresa.id));
}
FIN.iniciar = iniciar;
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
