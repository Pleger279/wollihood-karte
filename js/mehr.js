"use strict";
// ---------- Status ----------
// Links zu den Quellen, damit man selbst nachschauen kann
function sourceLink(name) {
  if (name === "Flatfox") {
    const pts = (S.config?.areas?.features || []).flatMap((f) => (f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] : (f.geometry?.coordinates || []).flatMap((p) => p[0])));
    if (!pts.length) return "https://flatfox.ch/de/search/";
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return `https://flatfox.ch/de/search/?east=${Math.max(...xs).toFixed(4)}&north=${Math.max(...ys).toFixed(4)}&south=${Math.min(...ys).toFixed(4)}&west=${Math.min(...xs).toFixed(4)}`;
  }
  const page = (S.config?.watch_pages || []).find((p) => (p.name || p.url) === name);
  return page ? page.url : null;
}
// Letzter Suchlauf zu lange her? (nur tagsüber, nachts ruht die Suche)
function runIsStale(h, minutes) {
  if (!h?.last_run || h.paused) return false;
  const hour = Number(new Intl.DateTimeFormat("de-CH", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Zurich" })
    .formatToParts(new Date()).find((x) => x.type === "hour").value);
  if (hour < 6) return false;
  const age = (Date.now() - new Date(h.last_run)) / 60000;
  const sinceSix = hour * 60 - 6 * 60 + new Date().getMinutes();     // morgens erst ab 6 Uhr messen
  return age > minutes && sinceSix > minutes;
}
// Beim Öffnen: ist der letzte Lauf über 45 Min. her, gleich einen starten (höchstens alle 10 Min.)
async function autoRun() {
  const h = S.health;
  if (!S.config || !runIsStale(h, 45)) return;
  const last = +store.get("wh_autorun") || 0;
  if (Date.now() - last < 10 * 60000) return;
  store.set("wh_autorun", String(Date.now()));
  try {
    const c = structuredClone(S.config); c.requested_at = new Date().toISOString();
    S.configSha = await writeJson("config.json", c, S.configSha, "Suche beim Öffnen gestartet");
    S.config = c; S.autoRunAt = Date.now(); renderStatus();
    setTimeout(load, 80000);
  } catch (e) { /* nicht schlimm, der nächste Lauf kommt sowieso */ }
}
function digestText(h) {
  const sent = h?.last_digest_sent, skipped = h?.last_digest_skipped;
  const parts = [];
  if (skipped && (!sent || skipped > sent)) parts.push(`zuletzt nicht verschickt, nichts Neues (${ago(skipped)})`);
  parts.push(sent ? "zuletzt verschickt " + ago(sent) : "verschickt: noch keine Angabe");
  return esc(parts.join(" · "));
}
function renderStatus() {
  const h = S.health;
  const src = Object.entries(h?.sources || {});
  const bad = src.filter(([, v]) => !v.ok);
  const stale = runIsStale(h, 120);
  $("subline").innerHTML = S.autoRunAt && Date.now() - S.autoRunAt < 120000
    ? `<span class="dot"></span>Sucht gerade …`
    : h?.last_run
      ? `<span class="dot ${bad.length || (h.push && !h.push.ok) || stale ? "bad" : ""}"></span><span class="${stale ? "stale" : ""}">${h.paused ? "Pausiert" : "Gesucht " + esc(ago(h.last_run))}</span>`
      : "Wohnungssuche Wollishofen";
  const pool = S.hits.filter(inSavedArea), nSt = (w) => pool.filter((x) => standOf(keyOf(x), x).s === w).length;
  // Quellen inkl. der einzelnen Abos (gelb oder rot zählt nicht als ok)
  const subs = Object.values(h?.newsletters || {});
  const allN = src.length + subs.length, allOk = src.length - bad.length + subs.filter((x) => x.level === "ok").length;
  $("stats").innerHTML = `
    <div class="stat"><b>${nSt("neu")}</b><span>neu</span></div>
    <div class="stat"><b>${nSt("fav")}</b><span>Favoriten</span></div>
    <div class="stat"><b>${allOk}/${allN}</b><span>Quellen ok</span></div>`;
  const srcRow = (name, level, msg, u, sub) => `<div class="src${sub ? " sub" : ""}"><span class="s ${level === "ok" ? "" : level}"></span>${u ? `<a class="srclink" href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(name)}</b> ↗</a>` : `<b>${esc(name)}</b>`}<div class="m">${esc(msg)}</div></div>`;
  const nl = Object.entries(h?.newsletters || {});
  const rows = [];
  src.forEach(([name, v]) => {
    let msg = `${v.msg} · ${ago(v.at)}`;
    if (name === "Abo-Mails" && v.ok && nl.length) {      // Zusammenfassung über alle Abos statt nur letzter Lauf
      const last = nl.map(([, x]) => x.last).filter(Boolean).sort().pop();
      const read = nl.reduce((a, [, x]) => a + (x.read || 0), 0), hit = nl.reduce((a, [, x]) => a + (x.hits || 0), 0);
      msg = `${nl.length} Abos${last ? " · letzte Mail " + ago(last) : ""} · ${read} Inserate gelesen, ${hit} passend (7 Tage)`;
    }
    rows.push(srcRow(name, v.ok ? "ok" : "bad", msg, sourceLink(name)));
    if (name === "Abo-Mails") nl.forEach(([n, x]) => rows.push(srcRow(n, x.level, x.level === "bad" ? x.msg : (x.last ? `letzte Mail ${ago(x.last)} · ` : "") + x.msg.replace(/^seit \d+ Tagen keine Mail · /, ""), x.url, true)));
  });
  const dl = [];
  dl.push(`<div class="src"><span class="s ${S.config?.digest?.enabled === false ? "warn" : ""}"></span><b>Tägliches Briefing</b><div class="m">${S.config?.digest?.enabled === false ? "ausgeschaltet" : digestText(h)}</div></div>`);
  if (h?.photos) dl.push(`<div class="src"><span class="s ${h.photos.ohne ? "warn" : ""}"></span><b>Fotos</b><div class="m">${h.photos.ohne ? `${h.photos.ohne} Treffer noch ohne Inseratefoto (Wollihood sucht weiter; in der App erscheint solange Screenshot oder Luftbild)` : "alle Treffer haben ein Foto"}${h.photos.gefunden ? ` · ${h.photos.gefunden} im letzten Lauf gefunden` : ""}</div></div>`);
  if (h?.push) dl.push(`<div class="src"><span class="s ${h.push.ok ? "" : "bad"}"></span><b>Push-Mitteilungen</b><div class="m">${h.push.ok ? "funktionieren · zuletzt geprüft " + esc(ago(h.push.at)) : esc(h.push.msg)}</div></div>`);
  $("delivery").innerHTML = dl.join("");
  $("sources").innerHTML = rows.join("") || '<p class="hint">Noch kein Lauf.</p>';
}
$("runBtn").addEventListener("click", async () => {
  const c = structuredClone(S.config); c.requested_at = new Date().toISOString();
  $("runBtn").disabled = true;
  if (await saveConfig(c, "Suche von Hand gestartet", "Suche gestartet. Die Ergebnisse erscheinen in etwa einer Minute.")) setTimeout(load, 75000);
  setTimeout(() => ($("runBtn").disabled = false), 60000);
});

// ---------- Laden, Tabs, Einrichtung ----------
async function load() {
  $("refreshBtn").classList.add("spin");
  try {
    const cfg = await readJson("config.json");
    S.config = cfg.data; S.configSha = cfg.sha; fillForm(); drawAreas(); renderSummary();
  } catch (e) {
    $("refreshBtn").classList.remove("spin");
    if (e.status === 401 || e.status === 404) { showSetup(e.message); return; }
    toast(e.message, "err", 8000); return;
  }
  const [hits, health, events, marks, social, people, arch, ags, man] = await Promise.allSettled([
    readJson("state/recent.json"), readJson("state/health.json"), readJson("state/events.json"), Promise.resolve(null),
    readJson("social.json"), readJson("people.json"), readJson("archiv/index.json"), readJson("agencies.json"), readJson("manual.json")]);
  if (man.status === "fulfilled") S.manual = man.value.data.items || [];
  if (arch.status === "fulfilled") S.archive = arch.value.data || {};
  if (ags.status === "fulfilled") { S.agencies = ags.value.data.agencies || {}; S.agenciesSha = ags.value.sha; }
  if (social.status === "fulfilled") { S.social = social.value.data.items || {}; S.socialSha = social.value.sha; }
  if (people.status === "fulfilled") { S.people = people.value.data.people || {}; S.peopleSha = people.value.sha; }
  renderMyPush(); syncDevicePerson();
  if (hits.status === "fulfilled") { S.hits = hits.value.data; store.set("wh_cache_hits", JSON.stringify(S.hits)); }
  if (health.status === "fulfilled") S.health = health.value.data;
  mergeManual();
  S.hits.forEach(shotOverlay);
  if (social.status === "fulfilled" && foldTwins(JSON.parse(JSON.stringify(S.social)))) socialOp("Doppel zusammengeführt", foldTwins);
  if (events.status === "fulfilled") S.events = events.value.data;
  if (!S.filterChosen) { S.filter = S.hits.some((x) => needsMe(keyOf(x), x)) ? "new" : "fav"; S.filterChosen = true; }
  renderHits(); renderStatus(); renderMarkers();
  autoRun();
  const sh = location.hash.match(/^#share=([\w]+)/); if (sh) handleShare(sh[1]);
  $("refreshBtn").classList.remove("spin");
  applyDeep(true);
}
function showTab(t) {
  if (t === "map" || t === "criteria") t = "search";
  if (t === "status") t = "settings";            // Status ist seit v73 Teil von «Mehr»
  if (S.tab === "search" && t !== "search" && S.areasDirty) toast("Achtung: Das geänderte Gebiet ist noch nicht gespeichert.", "err", 6000);
  S.tab = t; store.set("wh_tab", t);
  ["hits", "search", "status", "settings"].forEach((n) => ($("v-" + n).hidden = n !== t));
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  if (t === "search") { ensureMap(); setTimeout(fitMap, 0); }
  if (t === "settings") { renderPush(); renderStatus(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
document.addEventListener("click", (e) => {
  const h = e.target.closest(".panel.fold > h2"); if (h) { h.parentElement.classList.toggle("open"); return; }
  if (e.target.id === "subToggle") { const on = $("sources").classList.toggle("showsub"); e.target.textContent = on ? "Einzelne Abos ausblenden" : "Einzelne Abos zeigen"; }
});
$("refreshBtn").addEventListener("click", () => S.token && load());
function showSetup(err) {
  $("setup").hidden = false; $("tabbar").hidden = true;
  ["hits", "search", "status", "settings"].forEach((n) => ($("v-" + n).hidden = true));
  $("repoInput").value = S.repo;
  if (err) { $("setupMsg").textContent = err; $("setupMsg").hidden = false; }
}
function showApp() {
  $("setup").hidden = true; $("tabbar").hidden = false;
  try { S.hits = JSON.parse(store.get("wh_cache_hits") || "[]"); } catch {}
  S.filter = "new";
  showTab(S.tab); renderHits(); applyDeep(false); load();
}
$("connectBtn").addEventListener("click", () => {
  const t = $("tokenInput").value.trim(); if (!t) { $("tokenInput").focus(); return; }
  S.token = t; S.repo = $("repoInput").value.trim() || S.repo;
  store.set("wh_token", S.token); store.set("wh_repo", S.repo); $("setupMsg").hidden = true;
  showApp();
});
$("logoutBtn").addEventListener("click", () => { store.del("wh_token"); S.token = null; showSetup(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.token && S.config) load(); });


// ---------- Web-Push ----------
const VAPID_PUBLIC = "BEC006PeYd8byQ5aZW6O-YYPsLOSGG_emq7vkptzGHcB3FKo5t0wQqgezz4cFDmuTEjRoW0hhe3CojFsGeqIISo";
const SUBS_PATH = "state/subscriptions.json";
function urlB64ToBytes(b64) { const p = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
async function readSubs() {
  try { const r = await readJson(SUBS_PATH); const d = Array.isArray(r.data) ? { devices: r.data } : r.data; return { data: { devices: d.devices || [], ...d }, sha: r.sha }; }
  catch (e) { if (e.status === 404) return { data: { devices: [] }, sha: null }; throw e; }
}
function deviceLabel() {
  const ua = navigator.userAgent; const m = ua.match(/Android [\d.]+; ([^;)]+)/);
  return (m ? m[1].trim() : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Gerät") + (matchMedia("(display-mode: standalone)").matches ? " (App)" : " (Browser)");
}
async function currentSub() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready; return reg.pushManager.getSubscription();
}
async function renderPush() {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) { $("wpState").textContent = "Dieser Browser kann keine Push-Meldungen empfangen. Installiere die App über Chrome."; return; }
  const sub = await currentSub().catch(() => null);
  const perm = Notification.permission;
  if (perm === "denied") { $("wpState").textContent = "Mitteilungen sind für Wollihood blockiert. Erlaube sie in den Android-Einstellungen unter Apps → Wollihood → Benachrichtigungen."; ["wpOn","wpTest","wpOff"].forEach((i) => ($(i).hidden = true)); return; }
  $("wpState").textContent = sub ? "Aktiv. Neue Treffer kommen direkt als Mitteilung auf dieses Gerät." : "Noch nicht aktiv. Nach dem Aktivieren brauchst du ntfy nicht mehr.";
  $("wpOn").hidden = !!sub; $("wpTest").hidden = !sub; $("wpOff").hidden = !sub;
}
// Beim Öffnen: Gerät der richtigen Person zuordnen und – falls der Push-Dienst es abgemeldet hat (8.11.: Pascals Gerät
// fiel still aus der Liste, vier Tage kein Push) – von selbst wieder anmelden, sofern Mitteilungen erlaubt sind.
async function syncDevicePerson() {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    let sub = await currentSub();
    const { data, sha } = await readSubs();
    const d = sub && data.devices.find((x) => (x.subscription || x).endpoint === sub.endpoint);
    if (!d) {
      if (!sub) sub = await (await navigator.serviceWorker.ready).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) });
      await saveDevice(sub, "Push-Gerät wieder angemeldet");
      toast("Push war abgemeldet – dieses Gerät ist wieder angemeldet.", "ok", 6000);
      S.pushInFile = true; return;
    }
    S.pushInFile = true;
    if (!S.person || d.person === S.person) return;
    d.person = S.person;
    await writeJson(SUBS_PATH, { ...data, updated: new Date().toISOString() }, sha, "Gerät zugeordnet");
  } catch (e) { console.warn("Push-Abgleich", e); }
}
async function saveDevice(sub, message) {
  const { data, sha } = await readSubs();
  const json = sub.toJSON();
  const devices = data.devices.filter((d) => (d.subscription || d).endpoint !== json.endpoint);
  devices.push({ label: deviceLabel(), person: S.person || undefined, added: new Date().toISOString(), subscription: json });
  await writeJson(SUBS_PATH, { ...data, devices, updated: new Date().toISOString() }, sha, message);
}
$("wpOn").addEventListener("click", async () => {
  $("wpOn").disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Ohne Erlaubnis für Mitteilungen geht es nicht.", "err"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(VAPID_PUBLIC) });
    await saveDevice(sub, "Push-Gerät hinzugefügt");
    toast("Push aktiv. In etwa einer Minute kommt eine Testmeldung.", "ok", 7000);
  } catch (e) { toast("Aktivieren hat nicht geklappt: " + e.message, "err", 8000); }
  finally { $("wpOn").disabled = false; renderPush(); }
});
$("wpTest").addEventListener("click", async () => {
  $("wpTest").disabled = true;
  try { const sub = await currentSub(); if (sub) { await saveDevice(sub, "Push-Gerät Test"); toast("Testmeldung angefordert. Sie kommt in etwa einer Minute.", "ok", 7000); } }
  catch (e) { toast(e.message, "err"); }
  finally { setTimeout(() => ($("wpTest").disabled = false), 60000); }
});
$("wpOff").addEventListener("click", async () => {
  try {
    const sub = await currentSub(); if (!sub) return;
    const endpoint = sub.endpoint; await sub.unsubscribe();
    const { data, sha } = await readSubs();
    await writeJson(SUBS_PATH, { ...data, devices: data.devices.filter((d) => (d.subscription || d).endpoint !== endpoint) }, sha, "Gerät abgemeldet");
    toast("Dieses Gerät bekommt keine Push-Meldungen mehr.", "ok");
  } catch (e) { toast(e.message, "err"); }
  renderPush();
});


// ---------- Meine Push-Mitteilungen ----------
const MP_DEFAULT = { hits: true, pages: true, match: true, split: true, expiring: true, status: true, up: true, down: false, mail: true, source: true };
function renderMyPush() {
  const p = S.person;
  document.querySelectorAll("[data-who]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === p)));
  $("myPushPanel").classList.toggle("off", !p);
  $("myPushHint").textContent = p ? `Einstellungen für ${PEOPLE[p]}, gelten für alle deine Geräte.` : "Wähle oben zuerst, wer du bist.";
  if (p) $("mpOtherTitle").textContent = `Reaktionen von ${PEOPLE[otherOf(p)]}`;
  const me = (S.people[p] || {});
  const prefs = { ...MP_DEFAULT, ...(me.push || {}) };
  document.querySelectorAll("[data-mp]").forEach((el) => (el.checked = !!prefs[el.dataset.mp]));
  $("myQuietFrom").value = me.quiet?.from ?? (S.config?.quiet_hours?.from ?? "");
  $("myQuietTo").value = me.quiet?.to ?? (S.config?.quiet_hours?.to ?? "");
}
$("myPushSave").addEventListener("click", async () => {
  if (!S.person) { toast("Bitte zuerst wählen, wer du bist.", "err"); return; }
  const push = Object.fromEntries([...document.querySelectorAll("[data-mp]")].map((el) => [el.dataset.mp, el.checked]));
  const qf = $("myQuietFrom").value, qt = $("myQuietTo").value;
  const quiet = qf === "" || qt === "" ? null : { from: +qf, to: +qt };
  $("myPushSave").disabled = true;
  for (let i = 0; i < 3; i++) {
    try {
      let cur = { data: { people: {} }, sha: null };
      try { cur = await readJson("people.json"); } catch (e) { if (e.status !== 404) throw e; }
      const people = cur.data.people || {};
      people[S.person] = { ...(people[S.person] || {}), push, quiet };
      S.peopleSha = await writeJson("people.json", { people }, cur.sha, `Push-Einstellungen ${PEOPLE[S.person]}`);
      S.people = people; toast("Gespeichert.", "ok"); break;
    } catch (e) { if (!(e.status === 409 || e.status === 422) || i === 2) { toast(e.message, "err"); break; } }
  }
  $("myPushSave").disabled = false;
});

// Installation
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; $("installHint").hidden = true; });
$("installBtn").addEventListener("click", async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").hidden = true; });
if (window.matchMedia("(display-mode: standalone)").matches) { $("installHint").textContent = "Läuft als App."; }
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((reg) => { reg.update().catch(() => {}); }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

$("appVersion").textContent = "App-Version " + APP_VERSION;
S.token ? showApp() : showSetup();
