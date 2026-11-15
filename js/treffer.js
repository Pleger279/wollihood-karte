"use strict";
// ---------- Treffer ----------
function saveSeen() { store.set("wh_seen", JSON.stringify([...S.seen].slice(-500))); }
function isNew(x) { return !S.seen.has(keyOf(x)); }
const pubTime = (x) => new Date(x.published || x.first_seen).getTime();
function sortHits(list) {
  const by = S.sort || "new";
  const k = by === "price" ? (x) => x.rent ?? 1e9 : by === "size" ? (x) => -(x.m2 ?? -1) : (x) => -pubTime(x);
  return [...list].sort((a, b) => k(a) - k(b));
}
function pubLabel(x) {
  const prec = x.published_precision;
  if (!x.published || prec === "found") return `gefunden ${ago(x.first_seen)}`;
  let rel = ago(x.published);
  if (prec === "day") {
    const d = new Date(x.published), t = new Date(); const days = Math.round((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5);
    rel = days <= 0 ? "ca. heute" : days === 1 ? "ca. gestern" : "ca. " + d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
  }
  const gap = new Date(x.first_seen) - new Date(x.published);
  return `<b>Inseriert ${esc(rel)}</b>` + (gap > 2 * 3600e3 ? ` · gefunden ${esc(ago(x.first_seen))}` : "");
}
const MINI_ZOOM = 14;
function miniMap(x) {
  if (x.lat == null || x.lon == null) return "";
  return `<div class="mini" data-mapkey="${esc(keyOf(x))}" data-lat="${x.lat}" data-lon="${x.lon}" role="button" aria-label="Auf der Karte zeigen">
    <span class="lbl">Grosse Karte ›</span></div>`;
}
const minis = new Map();
const miniObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  entries.forEach((e) => { if (e.isIntersecting) { initMini(e.target); miniObserver.unobserve(e.target); } });
}, { rootMargin: "200px" }) : null;
function initMini(el) {
  if (el.dataset.ready || typeof L === "undefined") return;
  el.dataset.ready = "1";
  const ll = [+el.dataset.lat, +el.dataset.lon];
  const m = L.map(el, { center: ll, zoom: MINI_ZOOM, zoomControl: false, attributionControl: true, dragging: false,
    touchZoom: "center", scrollWheelZoom: false, doubleClickZoom: "center", boxZoom: false, keyboard: false });
  baseLayer({ minZoom: 10 }).addTo(m);
  m.attributionControl.setPrefix(false);
  L.control.zoom({ position: "topright", zoomInTitle: "Näher", zoomOutTitle: "Weiter weg" }).addTo(m);
  L.circleMarker(ll, { radius: 7, color: "#fff", weight: 3, fillColor: accent(), fillOpacity: 1, interactive: false }).addTo(m);
  m.on("click", () => showOnMap(el.dataset.mapkey));
  minis.set(el, m);
}
function mountMinis() {
  minis.forEach((m, el) => { if (!el.isConnected || !el.closest("#dBody")) { m.remove(); minis.delete(el); } });
  document.querySelectorAll("#hitList .mini[data-lat]").forEach((el) => (miniObserver ? miniObserver.observe(el) : initMini(el)));
}
function showOnMap(k) {
  const x = S.hits.find((h) => keyOf(h) === k); if (!x || x.lat == null) return;
  if (!$("detail").hidden) closeDetail(true);
  S.seen.add(k); saveSeen();
  S.focus = [x.lat, x.lon];
  setSearchMode("show"); showTab("search");
  const go = () => {
    S.map.invalidateSize();
    S.map.setView([x.lat, x.lon], 17, { animate: false });
    const m = S.markers && S.markers[k]; if (m) m.openPopup();
  };
  setTimeout(go, 80); setTimeout(() => { go(); S.focus = null; }, 350);
}
// ---------- Direkt zu einer Wohnung (aus Push oder Briefing) ----------
function parseDeep(href) {
  const h = new URL(href, location.href).hash.replace(/^#/, "");
  const q = new URLSearchParams(h);
  if (q.get("nachricht")) return { msg: q.get("nachricht") };
  return q.get("l") ? { key: q.get("l"), comments: q.get("c") === "1", tries: 0 } : null;
}
// Persönliche Nachricht in der App zeigen statt Gmail (14.11.: Gmail-Link öffnete am Handy nur eine Fehlerseite).
// Antworten = mailto: → eigene Mail-App, eigene Adresse. Wollihood schickt nie selbst.
function replyHref(m) {
  const addr = ((m.from || "").match(/<([^>]+)>/) || [, m.from || ""])[1].trim();
  const subj = /^(aw|re):/i.test(m.subject || "") ? m.subject : "AW: " + (m.subject || "");
  const quote = (m.text || "").split("\n").slice(0, 40).map((l) => "> " + l).join("\n");
  return `mailto:${encodeURIComponent(addr).replace(/%40/g, "@")}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent("\n\n" + quote)}`;
}
function showMsg(id) {
  const m = (S.health?.personal_mails || []).find((p) => p.id === id);
  if (!m) { toast("Diese Nachricht ist nicht mehr gespeichert – schau im Mailprogramm nach."); return; }
  const name = (m.from || "").replace(/\s*<[^>]+>/, "").replace(/"/g, "").trim() || m.from;
  $("nTitle").textContent = m.subject || "Nachricht";
  $("nBody").innerHTML = `<div class="nmsg"><div><b>Von:</b> ${esc(name)} <span class="hint">${esc(((m.from || "").match(/<([^>]+)>/) || [])[1] || "")}</span><br>
    <b>Datum:</b> ${esc(m.date || m.at || "")}</div>
    ${m.text ? `<pre>${esc(m.text)}</pre>` : `<p class="hint">Kein Text gespeichert (ältere Meldung).</p>`}
    <a class="btn primary" id="nReply" href="${esc(replyHref(m))}">Antworten in der Mail-App</a>
    <p class="hint">Öffnet dein Mailprogramm mit deiner eigenen Adresse. Wollihood verschickt nichts selbst.</p></div>`;
  $("nmsg").hidden = false; document.body.style.overflow = "hidden";
}
function closeMsg() { $("nmsg").hidden = true; document.body.style.overflow = ""; }
$("nClose").addEventListener("click", closeMsg);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("nmsg").hidden) closeMsg(); });
function applyDeep(final) {
  const d = S.deep; if (!d) return;
  if (d.msg) { if (!S.health) return; S.deep = null; history.replaceState(null, "", location.pathname); showMsg(d.msg); return; }
  if (!S.hits) return;
  const x = S.hits.find((h) => keyOf(h) === d.key || (h.keys || []).includes(d.key));
  if (!x) {
    if (final) { toast("Diese Wohnung ist nicht mehr in der Liste."); S.deep = null; history.replaceState(null, "", location.pathname); }
    return;
  }
  const k = keyOf(x);
  S.deep = null; history.replaceState(null, "", location.pathname);
  showTab("hits");
  if (!filtered().some((h) => keyOf(h) === k)) { S.filter = verdict(k) === "out" ? "out" : "all"; S.filterChosen = true; }
  if (d.comments) S.openThreads.add(k);
  renderHits();
  setTimeout(() => {
    const card = document.querySelector(`.card[data-key="${CSS.escape(k)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "start", behavior: "smooth" });
    card.classList.remove("act-flash"); void card.offsetWidth; card.classList.add("act-flash");
    if (d.comments) { const t = card.querySelector(".cform textarea"); if (t) setTimeout(() => t.focus({ preventScroll: true }), 500); }
  }, 60);
}
S.deep = parseDeep(location.href);
window.addEventListener("hashchange", () => { S.deep = parseDeep(location.href); applyDeep(false); });
if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => {
  if (e.data && e.data.type === "deeplink") { S.deep = parseDeep(e.data.url); applyDeep(false); if (S.token) load(); }
});
function inSavedArea(x) {
  return !!x.manual || x.lat == null || !S.config?.areas?.features?.length || inAreas(x.lat, x.lon, S.config.areas);
}
// Zeitpunkt des Aussortierens: von Hand gesetzt, sonst letzte Änderung (zweiter Daumen runter)
function outTime(k) { const it = itemOf(k); return new Date(it.out?.at || it.updated || 0).getTime() || 0; }
const dmy = (t) => (t ? new Date(t).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }) : "");
function filtered() {
  if (S.filter === "out") return S.hits.filter(inSavedArea).filter((x) => verdict(keyOf(x)) === "out")
    .sort((a, b) => outTime(keyOf(b)) - outTime(keyOf(a)));
  return sortHits(S.hits).filter(inSavedArea).filter((x) => {
    const k = keyOf(x), v = verdict(k);
    if (S.filter === "out") return v === "out";
    if (v === "out") return false;
    if (S.filter === "new") return isNew(x);
    if (S.filter === "fav") return inFav(k);
    return true;
  });
}
// ---------- Bewertungen & Kommentare ----------
const PEOPLE = { pascal: "Pascal", leonie: "Leonie" };
const otherOf = (p) => (p === "pascal" ? "leonie" : "pascal");
S.person = PEOPLE[store.get("wh_person")] ? store.get("wh_person") : null;
S.social = {}; S.socialSha = null; S.people = {}; S.peopleSha = null; S.openThreads = new Set();
const thumb = (dir) => `<svg viewBox="0 0 24 24" fill="currentColor"${dir === "down" ? ' style="transform:rotate(180deg)"' : ""}><path d="M2 10h4v11H2zM8 21h9.2a2 2 0 0 0 2-1.6l1.6-7.5A2 2 0 0 0 18.8 9.5H14V5a2.5 2.5 0 0 0-2.5-2.5L8 10z"/></svg>`;
const bubble = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>';
const itemOf = (k) => S.social[k] || { votes: {}, comments: [] };
function verdict(k) {
  const v = itemOf(k).votes || {};
  const a = v.pascal, b = v.leonie;
  if (itemOf(k).out || (a === "down" && b === "down")) return "out";
  if (a === "up" && b === "up") return "both";
  if (a && b && a !== b) return "split";
  return "";
}
const myVote = (k) => (S.person ? (itemOf(k).votes || {})[S.person] : null);
const isFav = (k) => verdict(k) !== "out" && (verdict(k) === "both" || !!itemOf(k).fav);
const STATUS = [["", "Noch nichts unternommen"], ["angefragt", "Angefragt"], ["besichtigung", "Besichtigung"],
  ["beworben", "Beworben"], ["zusage", "Zusage"], ["absage", "Absage"]];
const statusLabel = (st) => {
  if (!st || !st.value) return "";
  const base = (STATUS.find(([v]) => v === st.value) || [0, st.value])[1];
  if (st.value === "besichtigung" && st.when) {
    const d = new Date(st.when), day = d.toLocaleDateString("de-CH", { day: "numeric", month: "numeric" });
    if (d < new Date()) return `Besichtigt ${day}`;
    return `${base} ${d.toLocaleDateString("de-CH", { weekday: "short" })} ${day} ${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return base;
};
function toggleFav(k) {
  if (needPerson()) return;
  const me = S.person, label = (S.hits.find((h) => keyOf(h) === k) || {}).street || "Inserat";
  const on = !itemOf(k).fav;
  if (!on && verdict(k) === "both") { toast("Ihr habt beide Daumen hoch gegeben, darum bleibt sie in den Favoriten."); return; }
  socialOp(`${PEOPLE[me]} ${on ? "favorisiert" : "entfernt Favorit"} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {}, comments: [] });
    if (on) it.fav = { by: me, at: new Date().toISOString() }; else delete it.fav;
    it.updated = new Date().toISOString();
  });
}
// Von Hand aussortieren (gilt für beide), mit Rückgängig
function setOut(k, on) {
  if (needPerson()) return;
  const me = S.person, label = (S.hits.find((h) => keyOf(h) === k) || {}).street || "Inserat";
  socialOp(`${PEOPLE[me]} ${on ? "sortiert aus" : "holt zurück"} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {}, comments: [] });
    if (on) it.out = { by: me, at: new Date().toISOString() }; else delete it.out;
    it.updated = new Date().toISOString();
  });
  if (on) toastAction("Aussortiert.", "Rückgängig", () => setOut(k, false));
  else if (verdict(k) === "out") toast("Zurückgeholt, aber ihr habt beide Daumen runter gegeben. Ändere deinen Daumen, damit sie wieder erscheint.", "", 7000);
  else toast("Zurückgeholt.");
}
function setStatus(k, value, when) {
  if (needPerson()) return;
  const me = S.person, label = (S.hits.find((h) => keyOf(h) === k) || {}).street || "Inserat";
  socialOp(`Status ${value || "zurückgesetzt"} von ${PEOPLE[me]} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {}, comments: [] });
    if (value) it.status = { value, when: value === "besichtigung" ? (when || it.status?.when || null) : null, by: me, at: new Date().toISOString() };
    else delete it.status;
    it.updated = new Date().toISOString();
  });
}
// einmalig: alte Merkliste in Favoriten übernehmen
async function migrateMarks() {
  const keys = Object.entries(S.marks || {}).filter(([, v]) => v === "fav").map(([k]) => k);
  if (!keys.length || store.get("wh_marks_migrated")) return;
  const todo = keys.filter((k) => !itemOf(k).fav);
  store.set("wh_marks_migrated", "1");
  if (!todo.length) return;
  socialOp("Merkliste übernommen", (items) => {
    todo.forEach((k) => { const it = items[k] || (items[k] = { votes: {}, comments: [] }); it.fav = it.fav || { by: S.person || "pascal", at: new Date().toISOString() }; });
  });
}
// Doppelte Wohnung zusammengeführt (Suchskript merge_twins): Bewertung/Notizen der zweiten Fundstelle zum Hauptschlüssel holen
function foldTwins(items) {
  let n = 0;
  for (const x of S.hits || []) {
    const k = keyOf(x), rest = (x.keys || []).slice(1).filter((k2) => items[k2] && k2 !== k);
    for (const k2 of rest) {
      const a = items[k] || (items[k] = { votes: {}, comments: [] }), b = items[k2];
      if (b.folded_into === k) continue;
      for (const [p, v] of Object.entries(b.votes || {})) if (!(a.votes || (a.votes = {}))[p]) { a.votes[p] = v; }
      for (const f of ["fav", "out", "status", "steps"]) if (!a[f] && b[f]) a[f] = b[f];
      if ((b.note || "").trim()) a.note = (a.note || "").trim() ? `${a.note}\n\n${b.note}` : b.note;
      const have = new Set((a.comments || []).map((c) => c.at + c.text));
      a.comments = [...(a.comments || []), ...(b.comments || []).filter((c) => !have.has(c.at + c.text))].sort((u, v) => (u.at < v.at ? -1 : 1));
      b.folded_into = k; n++;
    }
  }
  return n;
}
let socialQueue = Promise.resolve();
function socialOp(label, apply) {
  // sofort lokal anwenden, dann mit dem neusten Stand im Repo zusammenführen
  apply(S.social); renderHits();
  socialQueue = socialQueue.then(async () => {
    for (let i = 0; i < 4; i++) {
      try {
        let cur = { data: { items: {} }, sha: null };
        try { cur = await readJson("social.json"); } catch (e) { if (e.status !== 404) throw e; }
        const items = cur.data.items || {};
        apply(items);
        S.socialSha = await writeJson("social.json", { items }, cur.sha, "Reaktion: " + label);
        S.social = items; renderHits(); renderMarkers();
        return;
      } catch (e) {
        if (!(e.status === 409 || e.status === 422) || i === 3) { toast("Nicht gespeichert: " + e.message, "err", 7000); return; }
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
  });
}
function needPerson() {
  if (S.person) return false;
  $("whoPanel").hidden = false; window.scrollTo(0, 0);
  toast("Bitte zuerst oben wählen, wer dieses Handy nutzt.", "err");
  return true;
}
function setVote(k, dir) {
  if (needPerson()) return;
  const me = S.person, label = (S.hits.find((h) => keyOf(h) === k) || {}).street || "Inserat";
  const val = myVote(k) === dir ? null : dir;
  S.seen.add(k); saveSeen();
  socialOp(`${PEOPLE[me]} ${val === "up" ? "dafür" : val === "down" ? "dagegen" : "neutral"} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {}, comments: [] });
    it.votes = it.votes || {};
    if (val) it.votes[me] = val; else delete it.votes[me];
    it.updated = new Date().toISOString();
  });
}
function addComment(k, text) {
  if (needPerson()) return;
  const me = S.person, t = text.trim(); if (!t) return;
  const c = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), by: me, at: new Date().toISOString(), text: t.slice(0, 1000) };
  S.openThreads.add(k);
  socialOp(`Kommentar von ${PEOPLE[me]}`, (items) => {
    const it = items[k] || (items[k] = { votes: {}, comments: [] });
    it.comments = it.comments || [];
    if (!it.comments.some((x) => x.id === c.id)) it.comments.push(c);
    it.updated = c.at;
  });
}
function deleteComment(k, id) {
  socialOp(`Kommentar gelöscht`, (items) => {
    const it = items[k]; if (!it) return;
    it.comments = (it.comments || []).filter((x) => !(x.id === id && x.by === S.person));
  });
}
function stLine(k) {
  const st = itemOf(k).status;
  if (!st || !st.value) return "";
  return `<button type="button" class="stline" data-detail><span>Stand: <b>${esc(statusLabel(st))}</b>${st.by ? ` · ${esc(PEOPLE[st.by] || st.by)}, ${esc(ago(st.at))}` : ""}</span><span aria-hidden="true">›</span></button>`;
}
