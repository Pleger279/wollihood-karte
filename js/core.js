"use strict";
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch {} },
  del(k) { try { localStorage.removeItem(k) } catch {} },
};
const S = {
  token: store.get("wh_token"),
  repo: store.get("wh_repo") || "Pleger279/Wollihood",
  config: null, configSha: null,
  hits: [], health: null, events: [],
  marks: {}, marksSha: null,
  seen: new Set(JSON.parse(store.get("wh_seen") || "[]")),
  filter: "new", tab: store.get("wh_tab") || "hits",
  map: null, hitLayer: null, areasDirty: false,
};

// ---------- GitHub ----------
function b64decode(s) { const bin = atob(s.replace(/\n/g, "")); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); }
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); }
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${S.repo}/contents/${path}`, {
    ...opts, cache: "no-store",
    headers: { Authorization: `Bearer ${S.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const e = new Error(r.status === 401 ? "Der Schlüssel ist ungültig oder abgelaufen."
      : r.status === 404 ? `«${path}» nicht gefunden. Stimmt das Repo, und hat der Schlüssel Zugriff darauf?`
      : r.status === 409 ? "Die Datei wurde inzwischen geändert. Bitte neu laden und nochmals speichern."
      : `GitHub meldet Fehler ${r.status}.`);
    e.status = r.status; throw e;
  }
  return r.json();
}
async function readJson(path) { const d = await gh(path); return { data: JSON.parse(b64decode(d.content)), sha: d.sha }; }
async function writeJson(path, data, sha, message) {
  const body = { message, content: b64encode(JSON.stringify(data, null, 2) + "\n"), branch: "main" };
  if (sha) body.sha = sha;
  const r = await gh(path, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  return r.content.sha;
}

// ---------- Helfer ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const chf = (v) => v ? "CHF " + Number(v).toLocaleString("de-CH") : "Preis offen";
const rooms = (v) => v == null ? "? Zi." : `${v} Zi.`;
const keyOf = (x) => (x.keys && x.keys[0]) || x.url;
function ago(iso) {
  if (!iso) return "–";
  const d = new Date(iso), m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  if (m < 60 * 24) return `vor ${Math.round(m / 60)} Std.`;
  if (m < 60 * 24 * 7) return `vor ${Math.round(m / 1440)} Tg.`;
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}
let toastTimer;
// Über offenen Fenstern (Details, Bewerbung) schwebt die Meldung, sonst sitzt sie in der Speicherleiste.
const sheetOpen = () => [...document.querySelectorAll(".sheet")].some((s) => !s.hidden);
// ---------- Rückmeldung an Knöpfen (v84, Pascal 14.11.: «ich weiss nie, ob jetzt wirklich was passiert») ----------
// Jeder Knopf: beim Antippen kurz eingedrückt. Startet er innert 2.5 s eine Anfrage (GitHub, Claude), zeigt er selbst
// «läuft … 3 s» bzw. «Claude arbeitet … 12 s», ist so lange gesperrt und danach «✓ …» oder «✕ …» (aus der Meldung).
// Läuft über einen fetch-Umschlag – neue Knöpfe bekommen das ohne eigenen Code. Knöpfe, die beim Neuzeichnen ersetzt
// werden, findet es über id bzw. data-Attribut wieder.
const ACT = { el: null, sel: "", at: 0, n: 0, t0: 0, tick: null, end: null, ki: false, err: null, ok: null, running: false };
function actSel(b) {
  if (b.id) return "#" + CSS.escape(b.id);
  if (b.htmlFor) return `label[for="${CSS.escape(b.htmlFor)}"]`;
  const card = b.closest("[data-key]"), pre = card && card !== b ? `[data-key="${CSS.escape(card.dataset.key)}"] ` : "";
  for (const a of b.attributes) if (a.name.startsWith("data-") && a.name !== "data-busy") return `${pre}${b.tagName.toLowerCase()}[${a.name}="${CSS.escape(a.value)}"]`;
  return "";
}
function actEl() { if (ACT.el && ACT.el.isConnected) return ACT.el; const e = ACT.sel && document.querySelector(ACT.sel); if (e) ACT.el = e; return e || null; }
function actArm(b) {
  if (ACT.running) return;
  ACT.el = b; ACT.sel = actSel(b); ACT.at = Date.now(); ACT.err = null; ACT.ok = null; ACT.ki = false;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button, .btn, .linkbtn, label[for]"); if (!b || b.disabled) return;
  b.classList.add("act-tap"); setTimeout(() => b.classList.remove("act-tap"), 170);
  // Tabs, Filter, Sortierung schalten nur um – keine Lauf-Anzeige (sonst würde ein Hintergrund-Laden dort erscheinen)
  if (!b.closest(".toast, .seg, .stabs, .tabbar, [data-filter], [data-sort], [data-tab], [data-stab], [data-bstep], [data-bptoggle], [data-tedit-on], [data-tcancel]")) actArm(b);
}, true);
document.addEventListener("change", (e) => {
  const t = e.target; if (t.type !== "file" || !t.id) return;
  const l = document.querySelector(`label[for="${CSS.escape(t.id)}"]`); if (l) actArm(l);
}, true);
function actPaint() {
  const el = actEl(); if (!el) return;
  const s = Math.round((Date.now() - ACT.t0) / 1000), small = el.offsetWidth < 96;
  el.classList.add("act-busy"); el.classList.remove("act-done", "act-fail");
  void s;   // v94 (Pascal 15.11.): keine ablaufenden Sekunden mehr
  el.setAttribute("data-busy", small ? (ACT.ki ? "✦ …" : "…") : ACT.ki ? "Claude arbeitet …" : "läuft …");
}
function actBegin(url) {
  if (!ACT.running && (!ACT.el || Date.now() - ACT.at > 2500)) return false;
  clearTimeout(ACT.end); ACT.n++;
  if (/api\.anthropic\.com/.test(url)) ACT.ki = true;
  if (!ACT.running) { ACT.running = true; ACT.t0 = Date.now(); actPaint(); clearInterval(ACT.tick); ACT.tick = setInterval(actPaint, 1000); }
  else if (ACT.ki) actPaint();
  return true;
}
function actShow(el, ok, text) {
  if (!el) return;
  el.classList.remove("act-busy"); el.classList.add(ok ? "act-done" : "act-fail");
  el.setAttribute("data-busy", el.offsetWidth < 96 ? (ok ? "✓" : "✕") : (ok ? "✓ " : "✕ ") + text);
  setTimeout(() => { el.classList.remove("act-done", "act-fail"); el.removeAttribute("data-busy"); }, ok ? 2500 : 6000);
}
function actFinish(tok) {
  if (!tok) return;
  ACT.n = Math.max(0, ACT.n - 1); if (ACT.n) return;
  clearTimeout(ACT.end);
  ACT.end = setTimeout(() => {                 // kurz warten: oft folgt gleich die nächste Anfrage
    if (ACT.n) return;
    clearInterval(ACT.tick); ACT.running = false;
    actShow(actEl(), !ACT.err, ACT.err || ACT.ok || "fertig");
    ACT.el = null; ACT.sel = ""; ACT.err = null; ACT.ok = null; ACT.ki = false;
  }, 600);
}
const actShort = (t) => { t = String(t || "").replace(/\s+/g, " ").trim(); const m = t.match(/^[^.!?–:]{3,34}/); return (m ? m[0] : t.slice(0, 34)).trim(); };
// Meldungen landen auch am Knopf; eine Meldung ohne Anfrage (z.B. «Bitte zuerst …») zeigt der Knopf sofort
function actToast(text, cls) {
  if (cls !== "err" && cls !== "ok") return;
  if (ACT.running) { if (cls === "err") ACT.err = actShort(text); else ACT.ok = actShort(text); return; }
  if (ACT.el && Date.now() - ACT.at < 2500) { actShow(actEl(), cls === "ok", actShort(text)); ACT.el = null; ACT.sel = ""; }
}
{
  const _fetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const tok = actBegin(url);
    try {
      const r = await _fetch(input, init);
      if (/api\.anthropic\.com\/v1\/messages/.test(url) && r.ok) kostenZaehlen(init, r.clone());
      return r;
    }
    catch (e) { if (tok && !ACT.err) ACT.err = "keine Verbindung"; throw e; }
    finally { actFinish(tok); }
  };
}
// ---------- Claude-Kosten (v87, Pascal 14.11.) ----------
// Jeder Claude-Aufruf der App: Tokens aus der Antwort × Preis → dossier/ki-kosten.json (Monate, nach Art, letzte 40).
// Das Suchskript zählt seine Aufrufe in state/health.json → ai_kosten. Anzeige: Mehr → Claude.
const KI_PREIS = { opus: [4, 20, 0.2, 5], sonnet: [2, 10, 0.1, 2.5], haiku: [1, 5, 0.1, 1.25], fable: [10, 50, 0.25, 12.5] };   // USD/Mio. Tokens
const USD_CHF = 0.82;   // Kurs Nov. 2026, gerundet
const KI_ART = { bewerbung: "Anschreiben", nachricht: "Kontakt-Nachricht", screenshots: "Screenshots", inserat: "Wohnung hinzufügen",
  formular: "Formular", foto: "Foto prüfen", regeln: "Schreibregeln", chat: "Chat" };
const KOSTEN = { neu: [], timer: null };
function kiUsd(model, u) {
  const p = Object.entries(KI_PREIS).find(([k]) => (model || "").includes(k))?.[1] || KI_PREIS.opus;
  return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6;
}
async function kostenZaehlen(init, resp) {
  try {
    const req = JSON.parse(init?.body || "{}"), j = await resp.json(), u = j.usage || {};
    const art = KI_ART[req.tools?.[0]?.name] || req.tools?.[0]?.name || "Claude";
    KOSTEN.neu.push({ at: new Date().toISOString(), by: S.person || null, art, model: req.model, in: u.input_tokens || 0, out: u.output_tokens || 0,
      cache: (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), usd: +kiUsd(req.model, u).toFixed(5) });
    clearTimeout(KOSTEN.timer); KOSTEN.timer = setTimeout(kostenSpeichern, 4000);   // gesammelt speichern
  } catch (e) { console.warn("Kosten", e); }
}
async function kostenSpeichern() {
  if (!KOSTEN.neu.length) return;
  const neu = KOSTEN.neu.splice(0);
  for (let i = 0; i < 4; i++) {
    try {
      let cur = { data: { monate: {}, letzte: [] }, sha: null };
      try { cur = await readJson("dossier/ki-kosten.json"); } catch (e) { if (e.status !== 404) throw e; }
      const d = cur.data; d.monate = d.monate || {}; d.letzte = d.letzte || [];
      for (const n of neu) {
        const m = d.monate[n.at.slice(0, 7)] = d.monate[n.at.slice(0, 7)] || { usd: 0, n: 0, art: {} };
        m.usd = +(m.usd + n.usd).toFixed(5); m.n++;
        const a = m.art[n.art] = m.art[n.art] || { usd: 0, n: 0 }; a.usd = +(a.usd + n.usd).toFixed(5); a.n++;
      }
      d.letzte = [...neu.reverse(), ...d.letzte].slice(0, 40);
      await writeJson("dossier/ki-kosten.json", d, cur.sha, `Claude-Kosten (+${neu.length})`);
      S.kosten = d; if (!$("v-settings")?.hidden) renderKosten();
      return;
    } catch (e) { if (!(e.status === 409 || e.status === 422) || i === 3) { KOSTEN.neu.unshift(...neu); return; } }
  }
}
const kiChf = (usd) => usd * USD_CHF < 1 ? `${(usd * USD_CHF * 100).toFixed(usd * USD_CHF * 100 < 10 ? 1 : 0)} Rp.` : `CHF ${(usd * USD_CHF).toFixed(2)}`;
async function renderKosten() {
  const box = $("kostenBox"); if (!box) return;
  if (!S.kosten) { try { S.kosten = (await readJson("dossier/ki-kosten.json")).data; } catch { S.kosten = { monate: {}, letzte: [] }; } }
  const mon = new Date().toISOString().slice(0, 7), m = S.kosten.monate?.[mon] || { usd: 0, n: 0, art: {} };
  const bot = S.health?.ai_kosten?.[mon] || { usd: 0, n: 0 };
  const arts = Object.entries(m.art || {}).sort((a, b) => b[1].usd - a[1].usd);
  box.innerHTML = `<div class="kostsum"><b>${kiChf(m.usd + bot.usd)}</b><span class="hint">diesen Monat · ${m.n + bot.n} Aufrufe · ca., Kurs ${USD_CHF}</span></div>
    <table class="kost"><tr><td>Suchlauf (Inserate einschätzen)</td><td>${bot.n}×</td><td>${kiChf(bot.usd)}</td></tr>
    ${arts.map(([a, v]) => `<tr><td>${esc(a)}</td><td>${v.n}×</td><td>${kiChf(v.usd)}</td></tr>`).join("")}</table>
    ${(S.kosten.letzte || []).length ? `<details><summary class="hint">Letzte Aufrufe</summary><table class="kost">${S.kosten.letzte.slice(0, 15).map((n) =>
      `<tr><td>${esc(dmy(n.at))} ${esc(n.art)}${n.by ? " · " + esc(PEOPLE[n.by] || n.by) : ""}</td><td>${Math.round((n.in + n.cache) / 1000)}k/${Math.round(n.out / 1000 * 10) / 10}k</td><td>${kiChf(n.usd)}</td></tr>`).join("")}</table></details>` : ""}`;
}
function toastAction(text, label, fn, ms = 6000) {
  const t = $("toast"); t.className = "toast act" + (sheetOpen() ? " float" : ""); t.hidden = false;
  t.innerHTML = `<span>${esc(text)}</span><button type="button" class="tbtn">${esc(label)}</button>`;
  t.querySelector("button").onclick = () => { t.hidden = true; fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function toast(text, cls = "", ms = 4000) {
  actToast(text, cls);
  const t = $("toast"); t.textContent = text; t.className = "toast " + cls + (sheetOpen() ? " float" : ""); t.hidden = false;
  clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#2F6B4F";
const icon = {
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  starO: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h6"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

