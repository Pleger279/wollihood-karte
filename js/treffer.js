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
  return q.get("l") ? { key: q.get("l"), tries: 0 } : null;
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
  if (!filtered().some((h) => keyOf(h) === k)) { S.filter = { neu: "new", fav: "fav", arch: "arch" }[standOf(k, x).s]; S.filterChosen = true; }
  renderHits();
  setTimeout(() => {
    const card = document.querySelector(`.card[data-key="${CSS.escape(k)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "start", behavior: "smooth" });
    card.classList.remove("act-flash"); void card.offsetWidth; card.classList.add("act-flash");
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
const dmy = (t) => (t ? new Date(t).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }) : "");
// Liste je Filter: Neu (noch zu entscheiden) · Favoriten · Archiv
function filtered() {
  const want = { new: "neu", fav: "fav", arch: "arch" }[S.filter] || "neu";
  const pool = S.hits.filter(inSavedArea).filter((x) => standOf(keyOf(x), x).s === want);
  if (want === "arch") return pool.sort((a, b) => standOf(keyOf(b), b).at - standOf(keyOf(a), a).at);
  return sortHits(pool);
}
// ---------- Entscheid pro Wohnung: Neu → Favoriten / Archiv (v98, Pascal 15.11.) ----------
// Jede Person gibt 👍 (behalten) oder 👎 (Archiv). Regeln (gleich im Suchskript: wollihood/people.py → stand; Tabelle
// tests/fixtures/stand_cases.json wird von beiden Seiten geprüft):
//   beide 👎 → Archiv · Stand gesetzt (angefragt …) oder mind. ein 👍 ohne 👎 → Favorit ·
//   sonst «Neu» (offen, einer 👎, uneinig) bis 7 Tage nach Fund bzw. letztem Daumen, dann Archiv.
// Von Hand hinzugefügt = 👍 der Person, die sie hinzugefügt hat. Früher: Stern = 👍, «aussortiert» = beide 👎.
const PEOPLE = { pascal: "Pascal", leonie: "Leonie" };
const otherOf = (p) => (p === "pascal" ? "leonie" : "pascal");
S.person = PEOPLE[store.get("wh_person")] ? store.get("wh_person") : null;
S.social = {}; S.socialSha = null; S.people = {}; S.peopleSha = null;
const thumb = (dir) => `<svg viewBox="0 0 24 24" fill="currentColor"${dir === "down" ? ' style="transform:rotate(180deg)"' : ""}><path d="M2 10h4v11H2zM8 21h9.2a2 2 0 0 0 2-1.6l1.6-7.5A2 2 0 0 0 18.8 9.5H14V5a2.5 2.5 0 0 0-2.5-2.5L8 10z"/></svg>`;
const itemOf = (k) => S.social[k] || { votes: {} };
const FRIST_TAGE = 7;
const hasStand = (it) => !!(it.status?.value || Object.keys(it.steps || {}).length);
function effVotes(it, x) {
  const v = { ...(it.votes || {}) };
  if (it.fav?.by) v[it.fav.by] = "up";
  if (it.out) { v.pascal = "down"; v.leonie = "down"; }
  const by = x?.manual?.by; if (by && PEOPLE[by] && !v[by]) v[by] = "up";
  return v;
}
function standCalc(it, x, now) {
  const v = effVotes(it, x), a = v.pascal, b = v.leonie;
  const ups = (a === "up") + (b === "up"), downs = (a === "down") + (b === "down");
  const ts = (t) => (t ? Date.parse(t) || 0 : 0);
  const t0 = Math.max(ts(x?.first_seen), ts(it.vat || (ups + downs ? it.updated : null)));
  const frist = t0 + FRIST_TAGE * 864e5;
  if (downs === 2) return { s: "arch", why: "beide", at: ts(it.out?.at || it.vat || it.updated) || t0, v };
  if (hasStand(it) || (ups && !downs)) return { s: "fav", v };
  if (now > frist) return { s: "arch", why: "frist", at: frist, v };
  return { s: "neu", split: ups === 1 && downs === 1, frist, v };
}
const standOf = (k, x, now = Date.now()) => standCalc(itemOf(k), x || hitByKey(k), now);
// Restzeit bis zum Archiv, für die Karte in «Neu»
function fristText(frist, now = Date.now()) {
  const d = Math.ceil((frist - now) / 864e5);
  return d <= 1 ? "letzter Tag" : `noch ${d} Tage`;
}
const STATUS = [["", "Noch nichts unternommen"], ["angefragt", "Angefragt"], ["besichtigung", "Besichtigung"],
  ["beworben", "Beworben"], ["zusage", "Zusage"], ["absage", "Absage"]];
const statusLabel = (st) => {
  if (!st || !st.value) return "";
  const base = (STATUS.find(([v]) => v === st.value) || [0, st.value])[1];
  if (st.value === "besichtigung" && st.when) {
    const d = new Date(st.when), day = d.toLocaleDateString("de-CH", { day: "numeric", month: "numeric" });
    if (d < new Date()) return `Besichtigt ${day}`;
    return `${base} ${day}`;      // Uhrzeit steht in der Zeile darunter («nächster Schritt»); das Schild muss kurz bleiben
  }
  return base;
};
// Doppelte Wohnung zusammengeführt (Suchskript merge_twins): Bewertung/Notizen der zweiten Fundstelle zum Hauptschlüssel holen
function foldTwins(items) {
  let n = 0;
  for (const x of S.hits || []) {
    const k = keyOf(x), rest = (x.keys || []).slice(1).filter((k2) => items[k2] && k2 !== k);
    for (const k2 of rest) {
      const a = items[k] || (items[k] = { votes: {} }), b = items[k2];
      if (b.folded_into === k) continue;
      for (const [p, v] of Object.entries(b.votes || {})) if (!(a.votes || (a.votes = {}))[p]) { a.votes[p] = v; }
      for (const f of ["fav", "out", "status", "steps"]) if (!a[f] && b[f]) a[f] = b[f];
      if ((b.note || "").trim()) a.note = (a.note || "").trim() ? `${a.note}\n\n${b.note}` : b.note;
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
// Daumen setzen; nochmals derselbe Daumen nimmt ihn zurück. Alte Felder (Stern, aussortiert) werden dabei zu Daumen.
function setVote(k, dir, quiet) {
  if (needPerson()) return;
  const me = S.person, x = hitByKey(k) || {}, label = x.street || "Inserat";
  const before = standOf(k, x), val = before.v[me] === dir ? null : dir;
  S.seen.add(k); saveSeen();
  const now = new Date().toISOString();
  socialOp(`${PEOPLE[me]} ${val === "up" ? "dafür" : val === "down" ? "dagegen" : "offen"} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {} });
    const v = effVotes(it, null); delete it.fav; delete it.out;
    if (val) v[me] = val; else delete v[me];
    it.votes = v; it.vat = now; it.updated = now;
  });
  const after = standOf(k, x);
  if (quiet || after.s === before.s) return;
  const prev = before.v[me], undo = () => setVote(k, prev || dir, true);   // vorheriger Daumen, sonst derselbe nochmals = zurücknehmen
  if (after.s === "arch") toastAction("Ins Archiv verschoben.", "Rückgängig", undo);
  else if (after.s === "fav") toastAction("Bei den Favoriten.", "Rückgängig", undo);
  else if (before.s === "arch") toast(after.split ? `Zurückgeholt – ${PEOPLE[otherOf(me)]} ist dagegen, ihr habt wieder ${FRIST_TAGE} Tage.` : "Zurückgeholt.", "ok", 6000);
  else toast("Wieder bei «Neu».", "");
}
