"use strict";
// ---------- Wohnung per Link (von Hand, ohne Suchraster) ----------
// Schlüssel wie im Suchskript (wollihood/sources/manual.py → key_for). Beide Seiten gleich halten!
const MAN_PATTERNS = [
  ["Homegate", /homegate\.ch\/(?:[a-z]{2}\/)?(?:mieten|rent|louer|affittare)\/(\d{6,12})/i, "smg", "https://www.homegate.ch/mieten/{id}"],
  ["ImmoScout24", /immoscout24\.ch\/(?:[a-z]{2}\/)?(?:d\/[^/?#\s]+\/|rent\/|mieten\/)(\d{6,12})/i, "smg", "https://www.immoscout24.ch/rent/{id}"],
  ["Newhome", /newhome\.ch\/[^\s?#]*?\/detail\/([A-Za-z0-9\-]{4,40})/i, "newhome", null],
  ["Comparis", /comparis\.ch\/immobilien\/[^\s?#]*?\/details\/show\/(\d{5,12})/i, "comparis", "https://www.comparis.ch/immobilien/marktplatz/details/show/{id}"],
  ["Flatfox", /flatfox\.ch\/[^\s?#]*?\/(\d{4,10})\/?(?:[?#\s]|$)/i, "flatfox", "https://flatfox.ch/de/flat/{id}/"],
];
const firstLink = (t) => { const m = String(t || "").match(/https?:\/\/[^\s<>"']+/); return m ? m[0].replace(/[.,;)]+$/, "") : ""; };
// Ohne Link (nur Screenshots, 14.11.): Schlüssel aus der Eintrags-Nummer – Suchskript: manual.key_without_link
async function manualKeyNoLink(id) {
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode("hand:" + id));
  return "manual:" + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
async function manualKey(url) {
  for (const [portal, rx, prefix, canon] of MAN_PATTERNS) {
    const m = url.match(rx);
    if (m) return { key: `${prefix}:${m[1]}`, portal, url: canon ? canon.replace("{id}", m[1]) : url };
  }
  const norm = url.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase();
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(norm));
  let host = ""; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { }
  return { key: "manual:" + [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12), portal: host || "Link", url };
}
const hitByKey = (k) => S.hits.find((h) => keyOf(h) === k || (h.keys || []).includes(k));
const normUrl = (u) => String(u || "").split(/[?#]/)[0].replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/i, "").toLowerCase();
const hitByUrl = (...us) => { const want = new Set(us.map(normUrl).filter(Boolean));
  return S.hits.find((h) => [h.url, ...(h.also_urls || []), ...(h.sources || []).map((s) => s.url)].some((u) => want.has(normUrl(u)))); };
function manualTag(x) {
  if (!x.manual) return "";
  const who = PEOPLE[x.manual.by] || "";
  return `<span class="tag hand">von Hand${who ? " · " + esc(who) : ""}</span>${x.manual.pending ? `<span class="tag">${x.manual.error ? "Fehler: " + esc(x.manual.error) : "wird geholt …"}</span>` : ""}`;
}
// Noch nicht verarbeitete Einträge aus manual.json gleich als Karte zeigen (auch auf dem anderen Handy)
function mergeManual() {
  const done = S.health?.manual_done || {};
  for (const it of S.manual || []) {
    if (!it.key || hitByKey(it.key)) continue;
    const d = done[it.id];
    if (d && d.ok) continue;    // verarbeitet, aber (noch) nicht in der Liste: nicht doppelt zeigen
    S.hits.unshift({ keys: [it.key], url: it.url || null, portal: it.portal, title: it.street || it.portal, street: it.street || null,
      plz: it.plz || null, city: it.city || null, rooms: it.rooms ?? null, rent: it.rent ?? null, m2: it.m2 ?? null,
      first_seen: it.at, published: it.at, published_precision: "found", sources: it.url ? [{ portal: it.portal, url: it.url, at: it.at }] : [],
      manual: { by: it.by, at: it.at, pending: true, error: d && !d.ok ? (d.error || "unbekannt") : null } });
  }
}
const numIn = (v) => { const n = parseFloat(String(v || "").replace(/['’\s]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
async function kiKey() {
  if (S.kiKey !== undefined) return S.kiKey;
  try { S.kiKey = (await readJson("dossier/ki.json")).data.anthropic_key || null; } catch { S.kiKey = null; }
  return S.kiKey;
}
// Claude liest Adresse, Zimmer, Miete aus Screenshots
const MAN_TOOL = { name: "inserat", description: "Angaben aus dem Wohnungsinserat (Screenshots).",
  input_schema: { type: "object", properties: {
    strasse: { type: "string", description: "Strasse und Hausnummer, leer wenn nicht sichtbar" }, plz: { type: "string" }, ort: { type: "string" },
    zimmer: { type: "number" }, miete_brutto: { type: "number", description: "Monatsmiete brutto in CHF (sonst netto)" },
    netto: { type: "boolean", description: "true, wenn nur die Nettomiete sichtbar ist" }, flaeche_m2: { type: "number" },
    text: { type: "string", description: "kurze Zusammenfassung des sichtbaren Inseratetexts (Bezug, Befristung, Besonderes), max. 400 Zeichen" } },
    required: ["strasse"] } };
async function manualReadShots(files) {
  const key = await kiKey();
  if (!key) throw new Error("Kein Claude-Schlüssel (Mehr → «Claude für Bewerbungen»).");
  const content = [];
  for (const f of [...files].filter((f) => f.type.startsWith("image/")).slice(0, 4)) {
    const b = await shrinkImage(f);
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobB64(b) } });
  }
  if (!content.length) throw new Error("Keine Bilder zum Lesen.");
  content.push({ type: "text", text: "Lies aus diesen Screenshots eines Wohnungsinserats die Angaben heraus und gib sie mit dem Werkzeug «inserat» zurück. Nur, was sichtbar ist; nichts erfinden." });
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: S.config?.ai?.model || "claude-opus-5-5", max_tokens: 1500, tools: [MAN_TOOL], tool_choice: { type: "auto" },
      messages: [{ role: "user", content }] }) });
  let j = {}; try { j = await r.json(); } catch { }
  if (!r.ok) throw new Error(r.status === 401 ? "Der Claude-Schlüssel ist ungültig." : j?.error?.message || `Claude meldet Fehler ${r.status}.`);
  const tu = (j.content || []).find((b) => b.type === "tool_use");
  if (tu?.input) return tu.input;
  const t = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join(""); const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { } }
  throw new Error("Claude hat nicht im erwarteten Format geantwortet.");
}
async function saveManualItem(item) {
  for (let i = 0; i < 4; i++) {
    try {
      let cur = { data: { items: [] }, sha: null };
      try { cur = await readJson("manual.json"); } catch (e) { if (e.status !== 404) throw e; }
      const items = (cur.data.items || []).filter((x) => x.id !== item.id);
      items.push(item);
      await writeJson("manual.json", { items }, cur.sha, `Wohnung von Hand: ${item.street || item.portal} (${PEOPLE[item.by]})`);
      S.manual = items; return;
    } catch (e) {
      if (!(e.status === 409 || e.status === 422) || i === 3) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}
function openManual(pre = {}) {
  if (needPerson()) return;
  S.detailKey = null; S.manFiles = [...(pre.files || [])];
  $("dTitle").textContent = "Wohnung hinzufügen";
  $("detail").hidden = false; document.body.style.overflow = "hidden";
  $("dBody").innerHTML = `<div class="panel manform">
    <p class="hint">Kommt in die Treffer, egal was das Suchraster sagt. Link oder Screenshots genügen. Bei Flatfox holt Wollihood alle Angaben selbst; sonst liest Claude sie aus den Screenshots.</p>
    <label class="f">Link zum Inserat (optional)<input class="field" id="mUrl" type="url" inputmode="url" placeholder="https://…" value="${esc(pre.url || "")}"></label>
    <div class="f"><small>Screenshots</small>
      <div class="manthumbs" id="mThumbs"></div>
      <label class="btn" for="mFiles">Screenshots wählen</label><input type="file" id="mFiles" accept="image/*,application/pdf" multiple hidden>
      <p class="hint" id="mKi" hidden></p></div>
    <label class="f">Strasse und Nr.<input class="field" id="mStreet" autocomplete="off"></label>
    <div class="row2"><label class="f">PLZ<input class="field" id="mPlz" inputmode="numeric" maxlength="4"></label><label class="f">Ort<input class="field" id="mCity" value="Zürich"></label></div>
    <div class="row3"><label class="f">Zimmer<input class="field" id="mRooms" inputmode="decimal"></label><label class="f">Miete brutto<input class="field" id="mRent" inputmode="numeric"></label><label class="f">m²<input class="field" id="mM2" inputmode="numeric"></label></div>
    <label class="f">Notiz (optional)<textarea class="field" id="mNote" rows="2" placeholder="z.B. Tipp von Nachbarin, Besichtigung Sa 10 Uhr">${esc(pre.note || "")}</textarea></label>
    <button type="button" class="btn primary" id="mSave">Hinzufügen</button></div>`;
  S.manText = pre.text || "";
  const thumbs = () => { $("mThumbs").innerHTML = S.manFiles.map((f) => f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="">` : `<span class="tag">PDF</span>`).join(""); };
  const readShots = async () => {
    if (!S.manFiles.some((f) => f.type.startsWith("image/"))) return;
    const st = $("mKi"); st.hidden = false; st.textContent = "Claude liest die Screenshots … (ca. 10–20 Sek.)";
    try {
      const r = await manualReadShots(S.manFiles);
      const put = (id, v) => { const el = $(id); if (el && v != null && v !== "" && !el.value.trim()) el.value = v; };
      put("mStreet", r.strasse); put("mPlz", r.plz); put("mCity", r.ort); put("mRooms", r.zimmer); put("mRent", r.miete_brutto); put("mM2", r.flaeche_m2);
      if (r.text) S.manText = [S.manText, r.text].filter(Boolean).join("\n");
      st.textContent = "✦ Von Claude ausgefüllt – bitte kurz prüfen." + (r.netto ? " Achtung: nur Nettomiete sichtbar." : "");
    } catch (e) { st.textContent = "Screenshots nicht gelesen: " + e.message + " Bitte von Hand ausfüllen."; }
  };
  thumbs(); readShots();
  $("mFiles").onchange = (e) => { S.manFiles.push(...e.target.files); thumbs(); readShots(); };
  $("mSave").onclick = () => saveManual();
}
async function saveManual() {
  const raw = $("mUrl").value.trim(), url = firstLink(raw) || (/^www\./i.test(raw) ? "https://" + raw : "");
  const hasShots = S.manFiles.some((f) => f.type.startsWith("image/"));
  if (raw && !url) { toast("Das ist kein Link (https://…). Feld leeren, wenn ihr nur Screenshots habt.", "err"); $("mUrl").focus(); return; }
  if (!url && !hasShots && !$("mStreet").value.trim()) { toast("Bitte einen Link oder Screenshots hinzufügen.", "err"); return; }
  const btn = $("mSave"); btn.disabled = true; btn.textContent = "Speichere …";
  try {
    const id = "m" + Date.now().toString(36);
    const mk = url ? await manualKey(url) : { key: await manualKeyNoLink(id), portal: "Screenshot", url: null }, k = mk.key;
    const known = hitByKey(k) || (url ? hitByUrl(url, mk.url) : null);
    const note = $("mNote").value.trim();
    if (known) {
      // schon in der Liste (oder wird gerade geholt): nur Screenshots/Notiz dazu
      if (S.manFiles.length || note) await uploadOwn(keyOf(known), S.manFiles, note);
      if (verdict(keyOf(known)) === "out") setOut(keyOf(known), false);
      S.manFiles = [];
      toast(known.manual?.pending ? "Diese Wohnung wird schon geholt." : "Diese Wohnung ist schon in der Liste.", "ok"); openDetail(keyOf(known)); return;
    }
    const item = { id, url: mk.url, key: k, portal: mk.portal, by: S.person, at: new Date().toISOString(),
      street: $("mStreet").value.trim() || null, plz: $("mPlz").value.trim() || null, city: $("mCity").value.trim() || null,
      rooms: numIn($("mRooms").value), rent: numIn($("mRent").value), m2: numIn($("mM2").value), note: note || null, text: S.manText || null };
    toast("Speichere …", "", 0);
    await saveManualItem(item);
    S.hits = S.hits.filter((h) => !(h.manual?.pending && keyOf(h) === k)); mergeManual();
    S.seen.add(k); saveSeen();
    const shotImgs = S.manFiles.filter((f) => f.type.startsWith("image/"));
    if (S.manFiles.length || note) await uploadOwn(k, S.manFiles, note);
    S.manFiles = []; renderHits();
    if (shotImgs.length && !k.startsWith("flatfox:")) setTimeout(() => shotsRun(k, shotImgs), 600);   // Fotos ausschneiden
    toast("Hinzugefügt. Wollihood holt die Details, in ca. 2 Min. ist sie fertig.", "ok", 6000);
    openDetail(k);
    setTimeout(load, 150000);
  } catch (e) {
    toast("Nicht gespeichert: " + e.message, "err", 8000);
    btn.disabled = false; btn.textContent = "Hinzufügen";
  }
}
$("addLinkBtn").addEventListener("click", () => openManual());
// Geteiltes aus anderen Apps entgegennehmen
async function handleShare(id) {
  let meta;
  try { const c = await caches.open("wollihood-share"); const r = await c.match(`./__share/${id}/meta`); meta = r && (await r.json()); } catch {}
  history.replaceState(null, "", location.pathname);
  if (!meta) return;
  const blob = `${meta.title} ${meta.text} ${meta.url}`;
  const ids = blob.match(/\d{6,12}/g) || [];
  const guess = S.hits.find((h) => (h.sources || [{ url: h.url }]).some((s) => blob.includes(s.url)) || (h.keys || []).some((k) => ids.some((n) => k.endsWith(":" + n))));
  const link = firstLink(`${meta.url} ${meta.text} ${meta.title}`);
  const loadFiles = async () => {
    const c = await caches.open("wollihood-share"), out = [];
    for (const f of meta.files) { const r = await c.match(f.path); if (r) out.push(new File([await r.blob()], decodeURIComponent(r.headers.get("X-Name") || f.name || "datei"), { type: f.type || "image/jpeg" })); }
    return out;
  };
  const asNew = async () => {
    const files = await loadFiles();
    const c = await caches.open("wollihood-share"); for (const key of await c.keys()) if (key.url.includes(`/__share/${id}/`)) await c.delete(key);
    openManual({ url: link, files, text: [meta.title, meta.text].filter(Boolean).join(" ").trim() });
  };
  if (!guess && link) { asNew(); return; }       // geteilter Link einer Wohnung, die Wollihood nicht kennt
  const rank = (h) => (h === guess ? 0 : verdict(keyOf(h)) === "out" ? 2 : 1);
  const list = [...S.hits].sort((a, b) => rank(a) - rank(b));
  S.detailKey = null;
  $("dTitle").textContent = "Geteilt";
  $("detail").hidden = false; document.body.style.overflow = "hidden";
  $("dBody").innerHTML = `<div class="panel"><h2>Zu welcher Wohnung?</h2>
      <p class="hint">${meta.files.length} Datei${meta.files.length === 1 ? "" : "en"}${meta.text || meta.url ? " und Text" : ""} geteilt.${guess ? " Passende Wohnung ist vorausgewählt." : ""}</p>
      <input class="field" id="shareFilter" placeholder="Strasse oder Quartier suchen">
      <div class="sharelist">${list.map((h) => `<label class="check"><input type="radio" name="shareTo" value="${esc(keyOf(h))}" ${h === guess ? "checked" : ""}><span class="cl">${esc(h.street || h.title || "Inserat")}<small>${esc([h.plz, QUARTER[h.plz] || h.city].filter(Boolean).join(" "))} · ${esc(rooms(h.rooms))} · ${esc(chf(h.rent))}${verdict(keyOf(h)) === "out" ? " · aussortiert" : ""}</small></span></label>`).join("") || '<p class="hint">Keine Treffer in der Liste.</p>'}</div>
      <button type="button" class="btn primary" id="shareSave">Speichern</button>
      <button type="button" class="btn" id="shareNew">Neue Wohnung anlegen</button></div>`;
  $("shareNew").onclick = asNew;
  $("shareFilter").oninput = (ev) => { const q = ev.target.value.toLowerCase(); $("dBody").querySelectorAll(".sharelist label").forEach((l) => (l.hidden = q && !l.textContent.toLowerCase().includes(q))); };
  $("shareSave").onclick = async () => {
    const k = ($("dBody").querySelector("input[name=shareTo]:checked") || {}).value;
    if (!k) { toast("Bitte eine Wohnung wählen.", "err"); return; }
    $("shareSave").disabled = true; toast("Speichere …", "", 0);
    const c = await caches.open("wollihood-share");
    const files = [];
    for (const f of meta.files) { const r = await c.match(f.path); if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get("X-Name") || f.name || "datei"), { type: f.type || "image/jpeg" })); }
    const note = [meta.title, meta.text, meta.url].filter(Boolean).join(" ").trim();
    const n = await uploadOwn(k, files, note);
    for (const key of await c.keys()) if (key.url.includes(`/__share/${id}/`)) await c.delete(key);
    toast(`Gespeichert${n ? `: ${n} Datei${n > 1 ? "en" : ""}` : ""}.`, "ok");
    openDetail(k);
  };
}
$("dBody").addEventListener("click", async (e) => {
  const k0 = S.detailKey;
  const stb = e.target.closest("[data-stab]"); if (stb && k0) { S.dTab = stb.dataset.stab; refreshStand(k0); return; }
  const sp = e.target.closest("[data-step]"); if (sp && k0) { if (sp.dataset.step === "bewerbung" && !confirm("Habt ihr die Bewerbung wirklich abgeschickt?")) return; setStep(k0, sp.dataset.step, sp.dataset.step === "besichtigung" ? { done: true } : {}); return; }
  const us = e.target.closest("[data-unstep]"); if (us && k0) { setStep(k0, us.dataset.unstep, null); return; }
  const an = e.target.closest("[data-answer]"); if (an && k0) { setStep(k0, "antwort", { value: an.dataset.answer }); return; }
  if (e.target.id === "kKi" && k0) { kontaktKi(k0); return; }
  if (e.target.id === "kCopy" && k0) {
    const t = $("kText").value.trim(), x = S.hits.find((h) => keyOf(h) === k0) || {};
    if (!t) { toast("Noch keine Nachricht.", "err"); return; }
    const offen = t.match(/\[[^\]]*\]/g);
    if (offen && !confirm(`In der Nachricht steht noch: ${offen.join(", ")}\n\nTrotzdem kopieren?`)) return;
    try { await navigator.clipboard.writeText(t); } catch { $("kText").select(); }
    if (t !== (KON.data?.text || "").trim()) kontaktSave(k0, t, true);
    if (!stepsOf(k0).kontakt) toastAction("Kopiert. Nach dem Senden:", "Als angefragt markieren", () => setStep(k0, "kontakt", {}), 15000);
    else toast("Nachricht kopiert.", "ok");
    return;
  }
  const dv = e.target.closest("[data-dvote]"); if (dv && k0) { setVote(k0, dv.dataset.dvote); refreshUs(); return; }
  if (e.target.closest("[data-dfav]") && k0) { toggleFav(k0); setTimeout(refreshUs, 30); return; }
  if (e.target.id === "dCmtSend" && k0) { const ta = $("dCmt"); if (ta.value.trim()) { addComment(k0, ta.value); refreshUs(); } return; }
  const dl = e.target.closest("[data-ddel]"); if (dl && k0) { deleteComment(k0, dl.dataset.ddel); setTimeout(refreshUs, 30); return; }
  const dout = e.target.closest("[data-dout]"); if (dout && k0) { setOut(k0, dout.dataset.dout === "1"); if (dout.dataset.dout === "1") closeDetail(); else refreshDetail(); return; }
  if (e.target.id === "dRestBtn") { S.dRestOpen = !S.dRestOpen; dRestSync(); if (S.dRestOpen) $("dRest").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  if (e.target.id === "dDescMore") { $("dDesc").classList.toggle("clamp"); e.target.textContent = $("dDesc").classList.contains("clamp") ? "Mehr lesen" : "Weniger"; return; }
  if (e.target.id === "ownNoteSave") {
    if (needPerson()) return;
    const k = S.detailKey, val = $("ownNote").value.trim();
    socialOp(`${PEOPLE[S.person]} Notiz`, (items) => { const it = items[k] || (items[k] = { votes: {}, comments: [] }); it.note = val; it.updated = new Date().toISOString(); });
    saveBtnState(); toast("Notiz gespeichert.", "ok"); return;
  }
  const zimg = e.target.closest(".gal img, .ownfiles img");
  if (zimg && zimg.src) { openViewer(zimg); return; }
  const doc = e.target.closest("[data-doc]");
  if (doc && !doc.closest("#bBody")) { e.preventDefault(); openDoc(doc.dataset.doc, doc.textContent.replace(/^📄\s*/, "")); return; }
  const sv = e.target.closest("#agSave");
  if (sv) {
    const name = sv.dataset.ag, k = agencyKey(name);
    const entry = { name, phone: $("agPhone").value.trim(), email: $("agEmail").value.trim(), website: $("agWeb").value.trim(), note: $("agNote").value.trim(), by: S.person || null, at: new Date().toISOString() };
    sv.disabled = true;
    for (let i = 0; i < 4; i++) {
      try {
        let cur = { data: { agencies: {} }, sha: null };
        try { cur = await readJson("agencies.json"); } catch (er) { if (er.status !== 404) throw er; }
        const all = cur.data.agencies || {}; all[k] = entry;
        S.agenciesSha = await writeJson("agencies.json", { agencies: all }, cur.sha, `Adressbuch: ${name}`);
        S.agencies = all; toast("Im Adressbuch gespeichert.", "ok"); break;
      } catch (er) { if (!(er.status === 409 || er.status === 422) || i === 3) { toast("Nicht gespeichert: " + er.message, "err"); break; } }
    }
    sv.disabled = false;
    const x = S.hits.find((h) => keyOf(h) === S.detailKey) || {}; const a = archEntry(x);
    let d = null; if (a) { try { d = (await readJson(`archiv/${a.id}/data.json`)).data; } catch {} }
    renderDetail(x, a, d); renderHits();
  }
});
const firstUrl = (x) => (x.sources && x.sources[0] && x.sources[0].url) || x.url;
// Tracking-Links aus Abo-Mails (z.B. Comparis), die Wollihood nicht auflösen kann
const TRACK_RX = /links\.comparis\.ch|\/s\/c\/|list-manage\.com|mailchi\.mp|\/\/(click|clicks|track|trk|email)\.|sendgrid\.net/i;
// Tracking-Links von Comparis führen auf die Startseite (lassen sich nicht auflösen, enthalten keine Inserate-Nummer).
// 1. gleiche Wohnung auf anderer Plattform (Suchskript links.py ersetzt den Link, App nimmt jede gute Fundstelle)
// 2. sonst gefilterte Comparis-Liste: PLZ, genaue Zimmerzahl, Miete ±50 → meist genau diese Wohnung
function comparisList(x) {
  const r = { DealType: 10, SiteId: 0, RootPropertyTypes: [], PropertyTypes: [] };
  if (x.plz) r.LocationSearchString = String(x.plz);
  if (x.rooms != null) { r.RoomsFrom = x.rooms; r.RoomsTo = x.rooms; }
  if (x.rent) { r.PriceFrom = Math.max(0, Math.round(x.rent) - 50); r.PriceTo = Math.round(x.rent) + 50; }
  return "https://www.comparis.ch/immobilien/result/list?requestobject=" + encodeURIComponent(JSON.stringify(r));
}
function searchUrl(x) {
  if (x.plz || x.rooms != null || x.rent) return comparisList(x);
  const q = x.street ? `"${x.street}"` : "Wohnung mieten";
  return "https://www.google.com/search?q=" + encodeURIComponent(`${q} site:comparis.ch`);
}
const portalOf = (u) => { const h = (u.match(/\/\/(?:www\.)?([^/]+)/) || [])[1] || ""; return ({ "flatfox.ch": "Flatfox", "homegate.ch": "Homegate", "immoscout24.ch": "ImmoScout24", "newhome.ch": "Newhome", "comparis.ch": "Comparis" })[h] || "der Plattform"; };
// erste Fundstelle mit echtem Link (Portal dazu), sonst null
function goodSource(x) {
  const list = [...(x.sources || []), { portal: x.portal, url: x.url }, ...(x.also_urls || []).map((u) => ({ portal: null, url: u }))];
  return list.find((s) => s.url && !TRACK_RX.test(s.url)) || null;
}
const goodUrl = (x) => { const g = goodSource(x); return g ? g.url : firstUrl(x) ? searchUrl(x) : null; };
function unresolved(x) {
  const all = [x.url, ...(x.sources || []).map((s) => s.url), ...(x.also_urls || [])].filter(Boolean);
  return all.length > 0 && all.every((u) => TRACK_RX.test(u));
}
function searchPanel(x) {
  if (!unresolved(x)) return "";
  const plz = x.plz || "", street = x.street || "";
  const g = (q) => "https://www.google.com/search?q=" + encodeURIComponent(q);
  const links = [];
  if (plz || x.rooms != null || x.rent) links.push(["Comparis-Liste", comparisList(x)]);
  if (street) links.push(["Google", g(`"${street}" ${plz} Wohnung mieten`)]);
  if (/^80\d\d$/.test(plz)) {
    links.push(["Homegate", `https://www.homegate.ch/rent/apartment/zip-${plz}/matching-list`]);
    links.push(["ImmoScout24", `https://www.immoscout24.ch/en/flat/rent/postcode-${plz}-zuerich`]);
  }
  if (!links.length) return "";
  return `<div class="panel"><h2>Inserat suchen</h2>
    <p class="hint">Der Link aus der Comparis-Mail führt nur auf die Startseite. Die Comparis-Liste ist auf PLZ, Zimmer und Miete gefiltert – meist steht dort nur diese Wohnung.</p>
    <div class="srchbtns">${links.map(([n, u]) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join("")}</div></div>`;
}
// Fundstellen: zuerst gefunden zuerst, jede antippbar
function sourcesHtml(x) {
  const list = (x.sources && x.sources.length ? x.sources : [{ portal: x.portal, url: x.url, at: x.first_seen }])
    .concat((x.also_urls || []).filter((u) => !(x.sources || []).some((s) => s.url === u)).map((u) => ({ portal: "weiterer Link", url: u, at: null })));
  return list.map((s) => `<a href="${esc(TRACK_RX.test(s.url || "") ? searchUrl(x) : s.url)}" target="_blank" rel="noopener" data-open>${esc(s.portal || "Link")}</a>${s.at ? " " + esc(new Date(s.at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })) : ""}`).join(" · ");
}
function setPerson(p) {
  S.person = p; store.set("wh_person", p);
  $("whoPanel").hidden = true;
  document.querySelectorAll("[data-who]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === p)));
  renderHits(); renderMyPush(); syncDevicePerson();
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-who]"); if (b) setPerson(b.dataset.who); });

// Name einer Wohnung ohne Strasse: «4-Zimmer-Wohnung, Wollishofen» statt rohem Inseratetitel
const placeName = (x) => x.street || [x.rooms != null ? `${x.rooms}-Zimmer-Wohnung` : "Wohnung", [x.plz, QUARTER[x.plz] || x.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
// Ersatzbilder: eigener Screenshot aus «Bewertung & Notizen», sonst Luftbild von swisstopo (frei nutzbar, © swisstopo)
const shotOk = (k) => { const sh = itemOf(k).shots; return sh && sh.status === "ok" ? sh : null; };
const shotFotos = (k) => (shotOk(k)?.fotos || []).map((f) => f.path).filter(Boolean);
// Ein ganzer Screenshot (Text, Knöpfe) ist kein Wohnungsfoto: nur solange Claude ihn nicht gelesen hat, als Notlösung
// Eigene Fotos (15.11.: Pascals Besichtigungsfotos wurden nicht gezeigt, weil bestätigte Screenshot-Angaben – hier aus dem Chat –
// alle eigenen Bilder als «gelesene Screenshots» ausschlossen; stattdessen Luftbild). Jetzt: nur echte Screenshots fallen weg
// (Name «Screenshot…»/«Bildschirmfoto…» oder in shots.quellen), Fotos zählen immer.
function isShotFile(f, k) {
  const n = f.name || "", sh = itemOf(k).shots;
  if (/screenshot|bildschirm|screen_?shot/i.test(n)) return true;
  if (/^(PXL|IMG|DSC|DCIM|photo|foto)[_-]/i.test(n)) return false;          // Kamera-Fotos zählen immer
  if (sh?.quellen) return sh.quellen.includes(n);
  return !!sh && sh.quelle !== "chat" && sh.status === "ok" && (!f.at || !sh.at || f.at <= sh.at);   // ältere Einträge ohne Quellenliste
}
const ownFotos = (k) => (itemOf(k).files || []).filter((f) => f.type !== "application/pdf" && !isShotFile(f, k)).map((f) => f.path);
const ownPhoto = (k) => shotFotos(k)[0] || ownFotos(k)[0] || null;
function aerialUrl(x) {
  if (x.lat == null || x.lon == null) return null;
  const d = 0.0008, dl = d * 1.48;          // ca. 90 × 120 m, Haus in der Mitte
  return `https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ch.swisstopo.swissimage&STYLES=&CRS=EPSG:4326&BBOX=${(+x.lat - d).toFixed(5)},${(+x.lon - dl).toFixed(5)},${(+x.lat + d).toFixed(5)},${(+x.lon + dl).toFixed(5)}&WIDTH=480&HEIGHT=360&FORMAT=image/jpeg`;
}
// Favoriten: alles mit Stern, zwei Daumen hoch oder einem Stand (läuft schon)
const inFav = (k) => verdict(k) !== "out" && (isFav(k) || !!itemOf(k).status?.value);
const ST_ORDER = ["besichtigung", "beworben", "angefragt", "zusage", "", "absage"];
const ST_GROUP = { besichtigung: "Besichtigung", beworben: "Beworben", angefragt: "Angefragt", zusage: "Zusage", "": "Noch nichts unternommen", absage: "Absage" };
function nextStep(k) {
  const st = stepsOf(k), b = st.besichtigung;
  if (st.antwort?.value) return st.antwort.value === "zusage" ? { t: "Zusage!" } : { t: "Absage", wait: true };
  if (st.bewerbung) return { t: `Beworben ${ago(st.bewerbung.at)} · warten auf Antwort`, wait: true };
  if (b?.when && new Date(b.when) > new Date()) { const d = new Date(b.when);
    return { t: `Besichtigung ${d.toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "numeric" })} ${d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`, wait: true }; }
  if (besDone(b)) return { t: "Bewerbung schicken ›" };
  if (st.kontakt) return { t: `Angefragt ${ago(st.kontakt.at)} · warten auf Antwort`, wait: true };
  return { t: "Kontakt aufnehmen ›" };
}
const houseIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>';
function hitCard(x, withNext) {
  const k = keyOf(x), it = itemOf(k), st = it.status, mine = myVote(k), v = verdict(k);
  const other = S.person ? otherOf(S.person) : null, ov = other ? (it.votes || {})[other] : null;
  const quarter = QUARTER[x.plz] || x.city || "";
  const l2 = [x.rooms != null ? `${x.rooms} Zi` : "Zimmer ?", x.m2 ? `${x.m2} m²` : "", quarter].filter(Boolean).join(" · ");
  const own = ownPhoto(k), aer = aerialUrl(x);
  // Foto: Inserat → eigener Screenshot → Luftbild (swisstopo); fällt das Inseratefoto aus, springt das Luftbild ein
  const sf = shotFotos(k)[0];
  const photo = sf ? `<img data-src="${esc(sf)}" alt="" loading="lazy">`
    : x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="${aer ? `this.onerror=null;this.src='${esc(aer)}'` : "this.remove()"}">`
    : own ? `<img data-src="${esc(own)}" alt="" loading="lazy">`
    : aer ? `<img src="${esc(aer)}" alt="Luftbild" loading="lazy" onerror="this.remove()"><span class="aerlbl">Luftbild</span>` : "";
  const haken = (x.ai?.haken || []).length && x.ai?.passt === false;
  const pill = st && st.value ? `<span class="spill st st-${esc(st.value)}">${esc(statusLabel(st))}</span>`
    : isFav(k) ? '<span class="spill fav">★ Favorit</span>' : v === "split" ? '<span class="spill split">Uneinig</span>' : "";
  const n = (it.comments || []).length;
  const ns = withNext ? nextStep(k) : null;
  const foot = v === "out"
    ? `<div class="outline"><span>${it.out ? "Aussortiert von " + esc(PEOPLE[it.out.by] || "") : "Beide Daumen runter"}${outTime(k) ? " · " + dmy(outTime(k)) : ""}</span><button type="button" class="linkbtn" data-out="0">Zurückholen</button></div>`
    : `<div class="cfoot">
        <button type="button" class="vmini up" data-vote="up" aria-pressed="${mine === "up"}" aria-label="Daumen hoch">${thumb("up")}</button>
        <button type="button" class="vmini down" data-vote="down" aria-pressed="${mine === "down"}" aria-label="Daumen runter">${thumb("down")}</button>
        ${other ? `<span class="ochip ${ov || ""}">${esc(PEOPLE[other])} ${ov ? thumb(ov) : "offen"}</span>` : ""}
        ${manualTag(x)}${x.swap ? '<span class="tag swap">Tausch</span>' : ""}
        ${n ? `<span class="cchip" data-detail>${bubble}${n}</span>` : ""}
      </div>`;
  return `<article class="card" data-key="${esc(k)}">
    <div class="chead" data-detail role="button" tabindex="0" aria-label="Details: ${esc(placeName(x))}">
      <div class="thumb">${photo}<span class="ph">${houseIcon}kein Foto</span>${isNew(x) ? '<span class="nb">Neu</span>' : ""}</div>
      <div class="cinfo">
        <div class="l1"><b class="${x.rent ? "" : "na"}">${x.rent ? "CHF " + esc(fmtN(x.rent)) : "Preis offen"}</b>${pill}</div>
        <div class="l2">${esc(l2)}</div>
        <div class="l3">${esc(x.street || x.sources?.[0]?.portal || x.portal || "")}${x.street || x.sources?.[0]?.portal || x.portal ? " · " : ""}${esc(ago(x.published || x.first_seen))}</div>
        ${x.ai && x.ai.text ? `<div class="l4">${haken ? '<span class="warn">!</span>' : '<span class="ai">✦</span>'} ${esc(x.ai.text)}</div>` : ""}
        ${ns ? `<div class="next${ns.wait ? " wait" : ""}">${esc(ns.t)}</div>` : ""}
        ${foot}
      </div>
    </div>
  </article>`;
}
function renderHits() {
  if (!["new", "fav", "all", "out"].includes(S.filter)) S.filter = "all";
  const pool = S.hits.filter(inSavedArea);
  const live = pool.filter((x) => verdict(keyOf(x)) !== "out");
  const cnt = { new: live.filter(isNew).length, fav: live.filter((x) => inFav(keyOf(x))).length, all: 0, out: pool.length - live.length };
  const names = { new: "Neu", fav: "Favoriten", all: "Alle", out: "Aussortiert" };
  const newN = cnt.new;
  document.querySelectorAll("[data-filter]").forEach((b) => {
    const f = b.dataset.filter;
    b.setAttribute("aria-pressed", String(f === S.filter));
    b.textContent = names[f] + (cnt[f] && f !== "out" ? " · " + cnt[f] : "");
  });
  $("whoPanel").hidden = !!S.person;
  $("newCount").hidden = !newN; $("newCount").textContent = newN;
  $("allSeenBtn").hidden = !(S.filter === "new" && newN > 1);
  const list = filtered();
  $("listCount").textContent = list.length ? `${list.length} ${S.filter === "new" ? (list.length === 1 ? "neue Wohnung" : "neue Wohnungen") : list.length === 1 ? "Wohnung" : "Wohnungen"}` : "";
  if (!list.length) {
    const msg = {
      new: ["Nichts Neues", "Sobald eine passende Wohnung auftaucht, erscheint sie hier und du bekommst eine Push-Meldung."],
      fav: ["Noch keine Favoriten", "Hier landen Wohnungen mit Stern, mit zwei Daumen hoch oder mit einem Stand (angefragt, Besichtigung …)."],
      all: ["Noch keine Treffer", "Die Suche läuft alle 30 Minuten. Treffer der letzten Wochen erscheinen hier."],
      out: ["Nichts aussortiert", "Haben beide Daumen runter gegeben, landet die Wohnung hier."],
    }[S.filter];
    $("hitList").innerHTML = `<div class="empty"><b>${msg[0]}</b>${msg[1]}</div>`;
    return;
  }
  if (S.filter === "fav") {
    const groups = new Map(ST_ORDER.map((g) => [g, []]));
    list.forEach((x) => { const g = itemOf(keyOf(x)).status?.value || ""; (groups.get(g) || groups.get("")).push(x); });
    $("hitList").innerHTML = [...groups].filter(([, xs]) => xs.length)
      .map(([g, xs]) => `<h3 class="grp st-${g || "none"}"><i></i>${ST_GROUP[g]} · ${xs.length}</h3>${xs.map((x) => hitCard(x, true)).join("")}`).join("");
  } else {
    $("hitList").innerHTML = list.map((x) => hitCard(x, false)).join("");
  }
  $("hitList").querySelectorAll(".thumb img[data-src]").forEach((img) => repoFile(img.dataset.src).then((u) => (img.src = u)).catch(() => img.remove()));
}
let marksQueue = Promise.resolve();
function setMark(k, val) {
  if (val) S.marks[k] = val; else delete S.marks[k];
  S.seen.add(k); saveSeen(); renderHits(); renderMarkers();
  marksQueue = marksQueue.then(async () => {
    try { S.marksSha = await writeJson("marks.json", S.marks, S.marksSha, "Treffer markiert"); }
    catch (e) {
      if (e.status === 409 || e.status === 422) {
        try { const cur = await readJson("marks.json"); S.marksSha = cur.sha;
          S.marksSha = await writeJson("marks.json", { ...cur.data, ...S.marks }, S.marksSha, "Treffer markiert"); }
        catch (e2) { toast("Markierung nur auf diesem Gerät gespeichert: " + e2.message, "err"); }
      } else toast("Markierung nur auf diesem Gerät gespeichert: " + e.message, "err");
    }
    store.set("wh_marks", JSON.stringify(S.marks));
  });
}
$("hitList").addEventListener("change", (e) => {
  const card = e.target.closest(".card"); if (!card) return;
  const k = card.dataset.key;
  if (e.target.matches("[data-status]")) setStatus(k, e.target.value, null);
  if (e.target.matches("[data-when]") && e.target.value) setStatus(k, "besichtigung", new Date(e.target.value).toISOString());
});
$("hitList").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches(".chead[data-detail]")) { e.preventDefault(); e.target.click(); return; }
  if (e.key === "Enter" && !e.shiftKey && e.target.matches("[data-cinput]")) {
    e.preventDefault(); const card = e.target.closest(".card"); addComment(card.dataset.key, e.target.value); e.target.value = "";
  }
});
$("hitList").addEventListener("click", (e) => {
  const card = e.target.closest(".card"); if (!card) return;
  const k = card.dataset.key;
  if (e.target.closest(".mini")) return;   // die kleine Karte kümmert sich selbst um Tippen und Zoomen
  const vb = e.target.closest("[data-vote]"); if (vb) { setVote(k, vb.dataset.vote); return; }
  if (e.target.closest("[data-fav]")) { toggleFav(k); return; }
  const ob = e.target.closest("[data-out]"); if (ob) { setOut(k, ob.dataset.out === "1"); return; }
  if (e.target.closest("[data-detail]")) { if (!S.seen.has(k)) { S.seen.add(k); saveSeen(); setTimeout(renderHits, 400); } openDetail(k); return; }
  if (e.target.closest("[data-thread]")) { S.openThreads.has(k) ? S.openThreads.delete(k) : S.openThreads.add(k); renderHits();
    if (S.openThreads.has(k)) setTimeout(() => document.querySelector(`.card[data-key="${CSS.escape(k)}"] [data-cinput]`)?.focus(), 50); return; }
  if (e.target.closest("[data-csend]")) { const ta = card.querySelector("[data-cinput]"); addComment(k, ta.value); ta.value = ""; return; }
  const del = e.target.closest("[data-del]"); if (del) { deleteComment(k, del.dataset.del); return; }
  const mb = null;
  if (mb) { setMark(k, mb.dataset.mark); return; }
  if (e.target.closest("[data-open]")) { S.seen.add(k); saveSeen(); setTimeout(renderHits, 400); }
});
S.sort = store.get("wh_sort") || "new";
function renderSort() { document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === S.sort))); }
document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { S.sort = b.dataset.sort; store.set("wh_sort", S.sort); renderSort(); renderHits(); }));
renderSort();
document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.filter; S.filterChosen = true; renderHits(); window.scrollTo(0, 0); }));
$("allSeenBtn").addEventListener("click", () => { S.hits.forEach((x) => S.seen.add(keyOf(x))); saveSeen(); renderHits(); });

