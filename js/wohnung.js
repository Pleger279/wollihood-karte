"use strict";
// ---------- Schritte: Kontakt · Besichtigung · Bewerbung · Antwort (frei umschaltbar, v66) ----------
// social[k].steps = { kontakt:{by,at}, besichtigung:{when,done,by,at}, bewerbung:{by,at}, antwort:{value,by,at} }
// social[k].status bleibt der «letzte Stand» (für Favoriten, Push «Stand geändert» und ältere Geräte).
const STEPS = [["kontakt", "Kontakt"], ["besichtigung", "Besichtigung"], ["bewerbung", "Bewerbung"], ["antwort", "Antwort"]];
function stepsOf(k) {
  const it = itemOf(k);
  if (it.steps) return it.steps;
  const st = it.status || {}, by = st.by, at = st.at;        // alte Einträge: aus dem Stand ableiten
  return st.value === "angefragt" ? { kontakt: { by, at } } : st.value === "besichtigung" ? { besichtigung: { when: st.when || null, by, at } }
    : st.value === "beworben" ? { bewerbung: { by, at } } : st.value === "zusage" || st.value === "absage" ? { antwort: { value: st.value, by, at } } : {};
}
const besDone = (b) => !!b && (b.done || (b.when && new Date(b.when) < new Date()));
const stepDone = (steps, n) => n === "besichtigung" ? besDone(steps.besichtigung) : !!steps[n];
function statusFrom(steps) {
  if (steps.antwort?.value) return { value: steps.antwort.value };
  if (steps.bewerbung) return { value: "beworben" };
  if (steps.besichtigung && (steps.besichtigung.when || steps.besichtigung.done)) return { value: "besichtigung", when: steps.besichtigung.when || null };
  if (steps.kontakt) return { value: "angefragt" };
  return null;
}
function setStep(k, name, data) {
  if (needPerson()) return;
  const me = S.person, label = (S.hits.find((h) => keyOf(h) === k) || {}).street || "Inserat", now = new Date().toISOString();
  socialOp(`Schritt ${name} ${data ? "gesetzt" : "zurückgesetzt"} von ${PEOPLE[me]} (${label})`, (items) => {
    const it = items[k] || (items[k] = { votes: {} });
    const steps = JSON.parse(JSON.stringify(it.steps || stepsOf(k)));
    if (data) steps[name] = { ...(steps[name] || {}), ...data, by: me, at: now }; else delete steps[name];
    it.steps = steps;
    const ns = statusFrom(steps);
    if (!ns) delete it.status;
    else if (it.status?.value !== ns.value || (it.status?.when || null) !== (ns.when || null)) it.status = { ...ns, when: ns.when || null, by: me, at: now };
    it.updated = now;
  });
  setTimeout(() => refreshStand(k), 30);
}
function defaultTab(k) {        // v93: der Schritt nach dem weitesten erledigten (übersprungene zählen nicht)
  const st = stepsOf(k); let last = -1; STEPS.forEach(([n], i) => { if (stepDone(st, n)) last = i; });
  return STEPS[Math.min(last + 1, STEPS.length - 1)][0];
}
function standPanel(k) {
  const steps = stepsOf(k), tab = S.dTab || defaultTab(k);
  const x = S.hits.find((h) => keyOf(h) === k) || {};
  const doneLine = (n, txt) => { const s = steps[n]; return `<p class="sdone">✓ ${esc(txt)}${s?.by ? ` · ${esc(PEOPLE[s.by] || s.by)}, ${esc(ago(s.at))}` : ""} <button type="button" class="btn sm" data-unstep="${n}">Rückgängig</button></p>`; };
  let body = "";
  if (tab === "kontakt") body = `<p class="hint">Kurze Nachricht fürs Kontaktfeld im Inserat – vor der Besichtigung.</p>
      <div class="bp-read" id="bRead-kontakt"><p class="hint">Lade …</p></div>
      <div class="bp-edit" data-tedit="kontakt" hidden>
        <textarea class="field" id="kText" rows="8" spellcheck="true" lang="de-CH" placeholder="Eure Nachricht – selbst schreiben oder einfügen."></textarea>
      </div>
      <div class="bp-bar" data-tbar="kontakt"></div><span class="hint" id="kState"></span>
      <div class="bp-pruef" id="bPruef-kontakt"></div>
      <div id="kTips"></div><div id="kLearn"></div>
      ${steps.kontakt ? doneLine("kontakt", "Angefragt") : `<button type="button" class="btn" data-step="kontakt">Als angefragt markieren</button>`}`;
  if (tab === "besichtigung") {
    const b = steps.besichtigung || {};
    const when = b.when ? new Date(new Date(b.when).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    body = `<label class="f"><small>Termin</small><input class="field" type="datetime-local" data-swhen value="${when}"></label>
      ${besDone(b) ? doneLine("besichtigung", b.when ? "Besichtigt am " + new Date(b.when).toLocaleDateString("de-CH") : "Besichtigt")
        : `<button type="button" class="btn" data-step="besichtigung">Als besichtigt markieren</button>`}`;
  }
  if (tab === "bewerbung") body = `<div id="bSlot"></div>
      <div class="dq-box"><button type="button" class="btn" id="bDossierQuick">⬇ Ganzes Dossier (PDF)</button><div id="bDossierQuickLink"></div></div>
      ${steps.bewerbung ? doneLine("bewerbung", "Beworben") : `<button type="button" class="btn" data-step="bewerbung">Als beworben markieren</button>`}`;
  if (tab === "antwort") { const v = steps.antwort?.value;
    body = `<div class="seg"><button type="button" class="opt" data-answer="zusage" aria-pressed="${v === "zusage"}">Zusage</button><button type="button" class="opt" data-answer="absage" aria-pressed="${v === "absage"}">Absage</button></div>
      ${v ? doneLine("antwort", v === "zusage" ? "Zusage" : "Absage") : '<p class="hint">Antwort der Verwaltung, sobald sie da ist.</p>'}`; }
  return `<div class="panel" id="dStand">
    <div class="stabs" role="tablist" aria-label="Schritte">${STEPS.map(([n, l]) => `<button type="button" role="tab" data-stab="${n}" aria-selected="${n === tab}" class="${stepDone(steps, n) ? "done" : ""}${n === "antwort" && steps.antwort?.value === "absage" ? " no" : ""}">${stepDone(steps, n) ? "✓" : ""}${l}</button>`).join("")}</div>
    <div class="sbody">${body}</div>
    ${firstUrl(x) ? `<a class="linkbtn" style="justify-self:center" href="${esc(goodUrl(x))}" target="_blank" rel="noopener">${goodSource(x) ? `Inserat auf ${esc(goodSource(x).portal || portalOf(goodSource(x).url))} öffnen ↗` : `Auf Comparis suchen ↗`}</a>` : ""}
  </div>`;
}
function refreshStand(k) {
  const el = $("dStand"); if (!el || S.detailKey !== k) return;
  bewPark(); el.outerHTML = standPanel(k); afterStand(k); festCheck(k);
}
function afterStand(k) {
  const tab = S.dTab || defaultTab(k);
  if (tab === "bewerbung") bewAttach(k);
  if (tab === "kontakt") kontaktLoad(k);
  const t = document.querySelector('#dBody [data-dpg="bewerben"]'); if (t) t.innerHTML = "Bewerben" + stepsDoneText(k);
}
// Bewerbung im Tab (v90): #bBody wird zwischen Tab und Halter verschoben, nie neu erzeugt (Listener und ungespeicherter Stand bleiben)
function bewPark() { const b = $("bBody"); if (b && b.parentElement !== $("bHolder")) $("bHolder").appendChild(b); }
function bewAttach(k) {
  const slot = $("bSlot"); if (!slot) return;
  slot.replaceWith($("bBody"));
  if (BEW.k !== k || !BEW.doc) bewLoad(k);
}
const bewActive = () => !!$("bBody")?.closest("#dStand") && !$("detail").hidden;
const bewUnsaved = () => !!(BEW.k && BEW.doc && $("bText") && (bewDirty() || (typeof FORM !== "undefined" && FORM.dirty)));
// Reiter der Wohnungsseite (v105): «Bewerben», sobald ein Schritt gesetzt ist, sonst «Wohnung». Wahl bleibt bis zum Schliessen.
function dPageOf(k) { return S.dPage || (Object.keys(stepsOf(k)).length ? "bewerben" : "wohnung"); }
function stepsDoneText(k) { const st = stepsOf(k), n = STEPS.filter(([s]) => stepDone(st, s)).length; return n ? ` <span class="dpg-n">${n}/${STEPS.length}</span>` : ""; }
function dPageSet(p) {
  S.dPage = p;
  document.querySelectorAll("#dBody [data-dpg]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.dpg === p)));
  if ($("dPgBewerben")) $("dPgBewerben").hidden = p !== "bewerben";
  if ($("dPgWohnung")) $("dPgWohnung").hidden = p !== "wohnung";
}
// Kontakt-Nachricht: archiv/<id>/bewerbung/kontakt.json, Claude schreibt beim ersten Öffnen
const KON = { k: null, sha: null, data: null, busy: false, auto: new Set(), edit: false, draft: null };
async function kontaktLoad(k) {
  const ta = $("kText"); if (!ta) return;
  const aid = await aidOf(k);
  if (KON.k !== k) { KON.k = k; KON.sha = null; KON.data = null;
    try { const r = await readJson(`archiv/${aid}/bewerbung/kontakt.json`); KON.data = r.data; KON.sha = r.sha; } catch { } }
  if (S.detailKey !== k || !$("kText")) return;
  if (!KON.edit) $("kText").value = KON.data?.text || "";
  else if (KON.draft != null) $("kText").value = KON.draft;
  saveBtnState();
  // 14.11.: kein automatischer Entwurf mehr (eigener Text wurde sonst überschrieben) – Claude schreibt nur auf Knopfdruck
  txRender("kontakt");
  if (KON.data?.text && $("kState")) $("kState").textContent = `Gespeichert${KON.data.by ? " von " + (PEOPLE[KON.data.by] || KON.data.by) : ""}, ${ago(KON.data.updated)}`;
}
async function kontaktSave(k, text, quiet) {
  if (needPerson()) return;
  const aid = await aidOf(k);
  const data = { ...(KON.data || {}), text, by: S.person, updated: new Date().toISOString() };
  try { KON.sha = await writeJson(`archiv/${aid}/bewerbung/kontakt.json`, data, KON.sha, `Kontakt-Nachricht (${PEOPLE[S.person]})`); KON.data = data; saveBtnState();
    if (!quiet) { toast("Nachricht gespeichert.", "ok"); if ($("kState")) $("kState").textContent = "Gespeichert."; }
  } catch (e) { toast("Nicht gespeichert: " + e.message, "err"); }
}
const KON_TOOL = { name: "nachricht", description: "Die erste Nachricht ans Kontaktfeld des Inserats und kurze Hinweise.",
  input_schema: { type: "object", required: ["nachricht"], properties: { nachricht: { type: "string", description: "Vollständige Nachricht mit Anrede «Guten Tag» und Grussformel" },
    hinweise: { type: "array", items: { type: "object", required: ["text"], properties: { art: { type: "string", enum: ["klaeren", "idee", "erklaerung"] }, text: { type: "string" } } } } } } };
function kontaktUser(c, auftrag) {
  return `Heute ist ${new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.

<stammdaten>
${JSON.stringify(c.stamm, null, 1)}
</stammdaten>

<stil_und_fruehere_texte>
${c.stil}
</stil_und_fruehere_texte>

<gelernte_regeln>
${(c.regeln || []).map((r) => "- " + r.regel).join("\n") || "(noch keine)"}
</gelernte_regeln>

<inserat>
${bewInserat(KON.k, S.hits.find((h) => keyOf(h) === KON.k) || {}, S.detailData)}
</inserat>

<aktuell>
${TX.get("kontakt") || "(noch leer)"}
</aktuell>

<auftrag>
${auftrag}
</auftrag>`;
}
// «✦ Entwurf schreiben» / «✦ Neu schreiben»: Claude schreibt die Kontakt-Nachricht (Prüfen = bpCheck, Änderungen = Chat)
async function kontaktKi(k) {
  if (KON.busy) return;
  const st = $("kState");
  try {
    const c = await bewCtx();
    if (!c.key) { if (st) st.textContent = "Kein Claude-Schlüssel (Mehr → «Claude für Bewerbungen»). Schreibt die Nachricht selbst."; return; }
    KON.busy = true; if (st) st.textContent = "Claude schreibt die Nachricht … (ca. 15–30 Sek.)"; $("kKi") && ($("kKi").disabled = true);
    const user = kontaktUser(c, `Schreibe die erste Nachricht fürs Kontaktfeld im Inserat: Erstkontakt vor der Besichtigung (Regeln oben). Kurz, natürlich, mit «Guten Tag» und Grussformel «Freundliche Grüsse» plus «Leonie Meier und Pascal Stadelmann». Nur die Nachricht, kein Anschreiben. Hinweise höchstens 2, nur «klaeren».`);
    const res = await claudeTool(BEW_SYSTEM.replace("Werkzeug «bewerbung»", "Werkzeug «nachricht»"), user, KON_TOOL, "nachricht");
    const text = String(res.nachricht || "").replace(/\r/g, "").trim();
    if (S.detailKey !== k || !$("kText") || !text) return;
    $("kText").value = text;
    $("kTips").innerHTML = (res.hinweise || []).filter((h) => h && h.text && (h.art || "klaeren") === "klaeren").slice(0, 2).map((h) => `<div class="tip">${esc(h.text)}</div>`).join("");
    if (st) st.textContent = "✦ Von Claude geschrieben – anpassen und dann kopieren.";
    kontaktSave(k, text, true).then(() => txRender("kontakt"));
    toast("Entwurf geschrieben", "ok");
    const tg = KON.edit ? $("kText") : $("bRead-kontakt");
    tg.scrollIntoView({ behavior: "smooth", block: "center" }); tg.classList.add("act-flash"); setTimeout(() => tg?.classList.remove("act-flash"), 1700);
  } catch (e) { if (st) st.textContent = "Claude: " + e.message; toast("Claude: " + e.message, "err", 7000); }
  finally { KON.busy = false; $("kKi") && ($("kKi").disabled = false); }
}
// Speichern-Knöpfe: «Speichern» sobald etwas geändert ist, sonst «Gespeichert»
const noteDirty = () => !!$("ownNote") && $("ownNote").value.trim() !== (itemOf(S.detailKey).note || "").trim();
const konDirty = () => !!$("kText") && KON.edit && KON.k === S.detailKey && $("kText").value.trim() !== (KON.data?.text || "").trim();
function saveBtnState() {
  const n = $("ownNoteSave"); if (n) { const d = noteDirty(); n.disabled = !d; n.textContent = d ? "Speichern" : "Gespeichert"; n.classList.toggle("primary", d); }
  const c = $("kSave"); if (c) { const d = konDirty(); c.disabled = !d; c.textContent = d ? "Speichern" : "Gespeichert"; c.classList.toggle("primary", d); }
}
document.addEventListener("input", (e) => { if (e.target.id === "ownNote" || e.target.id === "kText") saveBtnState(); if (e.target.id === "kText") KON.draft = e.target.value; });
// «Bewertung & Notizen»: Daumen, Stern, Kommentare, Notiz und eigene Dateien an einem Ort
// «Notizen & Fotos» (früher «Bewertung & Notizen»; Daumen stehen seit v98 oben beim Titel, Stern und Kommentare gibt es nicht mehr)
function usPanel(k) {
  const it = itemOf(k), files = it.files || [];
  return `<div class="panel" id="dUs"><h2>Notizen &amp; Fotos</h2>
    <label class="f"><small>Notiz</small>
      <textarea class="field" id="ownNote" rows="2" placeholder="Kontakt, Termine …">${esc(it.note || "")}</textarea></label>
    <div class="kbar"><button type="button" class="btn sm" id="ownNoteSave" disabled>Gespeichert</button></div>
    ${files.length ? `<div class="ownfiles">${files.map((f) => f.type === "application/pdf" ? `<a href="#" data-doc="${esc(f.path)}">📄 ${esc(f.name || "Dokument")}</a>`
      : `<img data-src="${esc(f.path)}" data-full="${esc(f.path)}" alt="${esc(f.name || "")}">`).join("")}</div>` : ""}
    ${shotsBox(k)}
    <label class="linkbtn" for="ownFiles" style="cursor:pointer">+ Foto, Screenshot oder Dokument</label>
    <input type="file" id="ownFiles" accept="image/*,application/pdf" multiple hidden></div>`;
}
function refreshUs() {
  const el = $("dUs"); if (!el || !S.detailKey) return;
  el.outerHTML = usPanel(S.detailKey);
  $("dUs").querySelectorAll("img[data-src]").forEach((img) => repoFile(img.dataset.src).then((u) => (img.src = u)).catch(() => img.remove()));
}
// Daumen oben auf der Wohnungsseite
const votePanel = (k, x) => {
  const sd = standOf(k, x);
  const arch = sd.s !== "arch" ? `<button type="button" class="linkbtn varch" data-darch="1">Ins Archiv</button>`
    : sd.why === "hand" ? `<button type="button" class="linkbtn varch" data-darch="0">Zurückholen</button>` : "";
  return `<div class="dvote" id="dVote">${voteRow(k, x, "data-dvote")}${arch}</div>`;
};
function voteSync(k) { const el = $("dVote"); if (el && S.detailKey === k) el.outerHTML = votePanel(k, hitByKey(k)); }
const QUARTER = { "8001": "Altstadt", "8004": "Aussersihl", "8005": "Industriequartier", "8006": "Oberstrass", "8008": "Riesbach",
  "8032": "Hottingen", "8037": "Wipkingen", "8047": "Albisrieden", "8048": "Altstetten", "8050": "Oerlikon", "8051": "Schwamendingen",
  "8053": "Witikon", "8057": "Unterstrass", "8064": "Altstetten", "8038": "Wollishofen", "8041": "Leimbach", "8002": "Enge", "8045": "Friesenberg", "8003": "Wiedikon", "8055": "Friesenberg", "8134": "Adliswil", "8135": "Langnau a.A.", "8802": "Kilchberg" };
// ---------- Details & Archiv ----------
S.archive = {}; S.agencies = {}; S.agenciesSha = null;
const archEntry = (x) => { if (!x) return null; for (const k of x.keys || [keyOf(x)]) { if (S.archive[k]) return S.archive[k]; } return null; };
const agencyKey = (n) => String(n || "").toLowerCase().replace(/\b(ag|sa|gmbh|sàrl|ltd)\b\.?/g, "").replace(/[^a-z0-9äöü]+/g, " ").trim();
const ATTR = { balconygarden: "Balkon/Garten", lift: "Lift", garage: "Garage", parkingspace: "Parkplatz", dishwasher: "Geschirrspüler",
  washingmachine: "Waschmaschine", tumbledryer: "Tumbler", parquetflooring: "Parkett", view: "Aussicht", cable: "Kabel-TV",
  petsallowed: "Haustiere erlaubt", wheelchairaccessible: "Rollstuhlgängig", minergie: "Minergie", fireplace: "Cheminée",
  raisedgroundfloor: "Hochparterre", childfriendly: "Kinderfreundlich", newbuilding: "Neubau", oldbuilding: "Altbau", quiet: "Ruhig" };
const fileCache = new Map();
async function repoFile(path) {
  if (fileCache.has(path)) return fileCache.get(path);
  const p = fetch(`https://api.github.com/repos/${S.repo}/contents/${path}`, {
    headers: { Authorization: `Bearer ${S.token}`, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" } })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); }).then((b) => URL.createObjectURL(b));
  fileCache.set(path, p);
  return p;
}
// --- Bildbetrachter: gross ansehen, wischen, zoomen -----------------------------------------
// Dokument aus dem privaten Repo öffnen (3.11.: Bausteine kamen auf Android ohne PDF-Typ und Endung an → nicht lesbar).
// Blob mit richtigem Typ; auf dem Handy als Datei mit Namen «….pdf» (öffnet im PDF-Viewer), am Computer in neuem Tab.
const MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", svg: "image/svg+xml" };
async function openDoc(path, name) {
  const ext = (path.split(".").pop() || "").toLowerCase(), type = MIME[ext] || "application/octet-stream";
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const win = !mobile ? window.open("", "_blank") : null;      // vor dem Laden öffnen, sonst blockiert der Browser
  try {
    const raw = await (await fetch(await repoFile(path))).blob();
    const url = URL.createObjectURL(new Blob([raw], { type }));
    if (win) { win.location.href = url; return; }
    const fn = String(name || path.split("/").pop()).replace(/[\\/:*?"<>|]+/g, " ").trim();
    const a = document.createElement("a"); a.href = url; a.download = fn.toLowerCase().endsWith("." + ext) ? fn : `${fn}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    toast(`«${a.download}» geladen.`, "ok");
  } catch (e) { if (win) win.close(); toast("Dokument nicht ladbar.", "err"); }
}
const V = { imgs: [], idx: 0, open: false };
function openViewer(img) {
  const box = img.closest(".gal, .ownfiles");
  V.imgs = [...box.querySelectorAll("img")].filter((i) => i.src).map((i) => ({ src: i.src, name: i.alt || "" }));
  V.idx = Math.max(0, V.imgs.findIndex((i) => i.src === img.src));
  const tr = $("vTrack");
  tr.innerHTML = V.imgs.map((i) => `<figure><img src="${esc(i.src)}" alt="${esc(i.name)}" draggable="false"></figure>`).join("");
  $("viewer").hidden = false; V.open = true;
  tr.scrollLeft = V.idx * tr.clientWidth;
  vUpdate();
  history.pushState({ viewer: 1 }, "");
}
function vUpdate() {
  $("vCount").textContent = V.imgs.length > 1 ? `${V.idx + 1} / ${V.imgs.length}` : "";
  $("vCount").hidden = V.imgs.length < 2;
  const cur = V.imgs[V.idx];
  $("vSave").href = cur?.src || "#";
  $("vSave").download = (cur?.name || `wollihood_${V.idx + 1}`).replace(/[^\w.-]+/g, "_") + (/\.(jpe?g|png|webp)$/i.test(cur?.name || "") ? "" : ".jpg");
}
function vHide() { if (!V.open) return; V.open = false; $("viewer").hidden = true; $("vTrack").innerHTML = ""; vz.reset(); }
function closeViewer() { if (!V.open) return; if (history.state?.viewer) history.back(); else vHide(); }
window.addEventListener("popstate", () => vHide());
$("vClose").addEventListener("click", closeViewer);
$("vTrack").addEventListener("scroll", () => {
  const tr = $("vTrack"), i = Math.round(tr.scrollLeft / Math.max(1, tr.clientWidth));
  if (i !== V.idx) { vz.reset(); V.idx = i; vUpdate(); }
}, { passive: true });
document.addEventListener("keydown", (e) => {
  if (!V.open) return;
  if (e.key === "Escape") { e.stopImmediatePropagation(); closeViewer(); }
  const tr = $("vTrack");
  if (e.key === "ArrowRight") tr.scrollBy({ left: tr.clientWidth, behavior: "smooth" });
  if (e.key === "ArrowLeft") tr.scrollBy({ left: -tr.clientWidth, behavior: "smooth" });
}, true);
// Zoom: zwei Finger, Doppeltipp; gezoomt verschieben mit einem Finger
const vz = (() => {
  const pts = new Map();
  let s = 1, tx = 0, ty = 0, start = null, img = null, lastTap = 0, moved = false;
  const apply = () => {
    if (!img) return;
    img.style.transform = s === 1 ? "" : `translate(${tx}px, ${ty}px) scale(${s})`;
    $("vTrack").classList.toggle("zoomed", s > 1);
  };
  const clamp = () => {
    if (!img) return;
    const w = img.offsetWidth, h = img.offsetHeight;
    tx = Math.min(0, Math.max(w - w * s, tx)); ty = Math.min(0, Math.max(h - h * s, ty));
  };
  const zoomAt = (ns, cx, cy) => {        // cx/cy in Bildschirmkoordinaten
    const r = img.getBoundingClientRect(), ox = r.left - tx, oy = r.top - ty;
    const px = (cx - ox - tx) / s, py = (cy - oy - ty) / s;
    s = Math.min(5, Math.max(1, ns));
    tx = cx - ox - px * s; ty = cy - oy - py * s;
    if (s === 1) { tx = ty = 0; }
    clamp(); apply();
  };
  const tr = $("vTrack");
  tr.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".viewer img");
    if (!t) { if (e.target.closest("figure") && s === 1) start = { bg: true, x: e.clientX, y: e.clientY }; return; }
    if (img !== t) { reset(); img = t; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      start = { d: Math.hypot(a.x - b.x, a.y - b.y), s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    } else if (pts.size === 1) start = { x: e.clientX, y: e.clientY, tx, ty };
    if (s > 1 || pts.size === 2) tr.setPointerCapture?.(e.pointerId);
  });
  tr.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && start?.d) {
      const [a, b] = [...pts.values()];
      zoomAt(start.s * Math.hypot(a.x - b.x, a.y - b.y) / start.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = true; e.preventDefault();
    } else if (pts.size === 1 && s > 1 && start) {
      tx = start.tx + e.clientX - start.x; ty = start.ty + e.clientY - start.y;
      if (Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 6) moved = true;
      clamp(); apply(); e.preventDefault();
    } else if (start && Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 10) moved = true;
  });
  const up = (e) => {
    const wasTap = pts.size === 1 && !moved;
    pts.delete(e.pointerId);
    if (pts.size === 1) { const [p] = [...pts.values()]; start = { x: p.x, y: p.y, tx, ty }; return; }
    if (e.type === "pointerup" && wasTap) {
      const now = Date.now();
      if (now - lastTap < 300) { zoomAt(s > 1 ? 1 : 2.5, e.clientX, e.clientY); lastTap = 0; }
      else lastTap = now;
    }
    start = null;
  };
  tr.addEventListener("pointerup", up); tr.addEventListener("pointercancel", up);
  // Tipp neben das Bild schliesst
  tr.addEventListener("click", (e) => { if (!e.target.closest("img") && s === 1 && !moved) closeViewer(); });
  tr.addEventListener("wheel", (e) => {
    const t = e.target.closest(".viewer img"); if (!t || !e.ctrlKey && Math.abs(e.deltaY) < 1) return;
    if (img !== t) { reset(); img = t; }
    e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
  }, { passive: false });
  function reset() { if (img) img.style.transform = ""; s = 1; tx = ty = 0; img = null; pts.clear(); start = null; tr.classList.remove("zoomed"); }
  return { reset };
})();

function leaveGuard() {
  if (!(noteDirty() || konDirty() || bewUnsaved())) return true;
  if (!confirm("Notiz, Nachricht oder Bewerbung ist nicht gespeichert. Trotzdem schliessen?")) return false;
  BEW.k = null; BEW.doc = null; KON.edit = false; KON.draft = null; return true;
}
function closeDetail(force) {
  if (force !== true && !leaveGuard()) return;
  bewPark(); KON.edit = false; KON.draft = null;
  chatHide(); $("detail").hidden = true; document.body.style.overflow = ""; if (location.hash.startsWith("#d=")) history.replaceState(null, "", location.pathname); }
$("dClose").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("detail").hidden) closeDetail(); });
async function openDetail(k) {
  if (!$("detail").hidden && S.detailKey !== k && !leaveGuard()) return;
  const x = S.hits.find((h) => keyOf(h) === k) || {};
  const a = archEntry(x);
  if (S.detailKey !== k) { KON.edit = false; KON.draft = null; if (BEW.k && BEW.k !== k) { BEW.k = null; BEW.doc = null; } }
  bewPark(); S.detailKey = k; S.dTab = null; S.dPage = null;
  $("dTitle").textContent = "Wohnung";
  $("detail").hidden = false; document.body.style.overflow = "hidden";
  $("dBody").innerHTML = '<p class="hint">Lade …</p>';
  let d = null;
  if (a) { try { d = (await readJson(`archiv/${a.id}/data.json`)).data; } catch (e) { d = null; } }
  renderDetail(x, a, d);
}
function renderDetail(x, a, d) {
  bewPark();
  const onl = !a ? "" : a.online === "offline" ? `<div class="onl offline">Offline seit ${esc(ago(a.offline_since))} · gesichert ${esc(ago(a.archived_at))}</div>`
    : a.online === "reserviert" ? `<div class="onl reserviert">Reserviert · gesichert ${esc(ago(a.archived_at))}</div>`
    : a.online === "online" ? `<div class="onl online">Noch online · gesichert ${esc(ago(a.archived_at))}</div>`
    : `<div class="onl">Gesichert ${esc(ago(a.archived_at))} · Online-Status bei diesem Portal nicht prüfbar</div>`;
  const imgs = (d?.images || []);
  const sfs = shotFotos(S.detailKey), sfm = (shotOk(S.detailKey)?.fotos || []).filter((f) => f.path), own = ownFotos(S.detailKey);
  const figs = [
    ...sfs.map((pth, i) => ({ html: `<img data-src="${esc(pth)}" data-full="${esc(pth)}" alt="">`, cap: sfm[i]?.muster ? "Musterfoto" : sfm[i]?.art === "grundriss" ? "Grundriss" : "aus Screenshot" })),
    ...imgs.map((im) => ({ html: `<img data-src="archiv/${esc(a.id)}/${esc(im.file)}" alt="${esc(im.caption || "")}">`, cap: "Inserat" })),
    ...(!sfs.length && !imgs.length && x.image ? [{ html: `<img src="${esc(x.image)}" alt="" referrerpolicy="no-referrer">`, cap: "Inserat" }] : []),
    ...own.map((pth) => ({ html: `<img data-src="${esc(pth)}" data-full="${esc(pth)}" alt="">`, cap: "eigenes Foto" })),
  ];
  const gal = figs.length ? `<div class="gal">${figs.map((f, i) => `<figure>${f.html}<figcaption>${i + 1}/${figs.length} · ${f.cap}</figcaption></figure>`).join("")}</div>`
    : aerialUrl(x) ? `<div class="gal"><figure><img src="${esc(aerialUrl(x))}" alt="Luftbild"><figcaption>Luftbild · © swisstopo · kein Inseratefoto</figcaption></figure></div>` : "";
  const f = d?.facts || {};
  const fact = (l, v) => (v != null && v !== "" ? `<div><span class="cap">${l}</span><b>${esc(v)}</b></div>` : "");
  const adr = [x.street, [x.plz, x.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const facts = `<div class="dfacts">${adr ? `<div class="dadr"><span class="cap">Adresse</span><b>${esc(adr)}</b></div>` : ""}${fact("Miete brutto", (f.rent_gross || x.rent) ? "CHF " + fmtN(f.rent_gross || x.rent) : null)}${fact("Netto + NK", f.rent_net ? `${fmtN(f.rent_net)} + ${fmtN(f.rent_charges || 0)}` : null)}
    ${fact("Zimmer", x.rooms ?? f.number_of_rooms)}${fact("Fläche", (x.m2 || f.livingspace) ? (x.m2 || f.livingspace) + " m²" : null)}${fact("Etage", f.floor != null ? (f.floor === 0 ? "EG" : f.floor + ". OG") : x.floor_text || null)}
    ${fact("Baujahr", f.year_built)}${fact("Renoviert", f.year_renovated)}${fact("Bezug", f.moving_date ? new Date(f.moving_date).toLocaleDateString("de-CH") : f.moving_date_type === "imm" ? "sofort" : (x.moving_date ? new Date(x.moving_date).toLocaleDateString("de-CH") : x.moving_date_text || null))}${fact("Befristung", x.limited_text)}</div>`;
  // Kontakt
  const ag = d?.agency || (x.agency ? { name: x.agency } : null);
  const book = ag ? (S.agencies[agencyKey(ag.name)] || {}) : {};
  const c = d?.contacts || {};
  const lines = [];
  if (ag) {
    lines.push(`<div class="ag">${ag.logo ? `<img data-src="archiv/${esc(a.id)}/${esc(ag.logo)}" alt="">` : ""}<div><b>${esc(ag.name)}</b>${ag.name_2 ? "<br>" + esc(ag.name_2) : ""}${ag.street ? `<br><span class="hint">${esc(ag.street)}, ${esc(ag.zipcode || "")} ${esc(ag.city || "")}</span>` : ""}</div></div>`);
  } else if (d) lines.push('<p class="hint">Privat inseriert oder keine Verwaltung angegeben. Kontakt über das Inserat bzw. den Bewerbungslink.</p>');
  if (d?.reference) lines.push(`<div>Referenz / Objekt-Nr.: <span class="ref">${esc(d.reference)}</span></div>`);
  if (book.phone) lines.push(`<div>☎ <a href="tel:${esc(book.phone.replace(/\s/g, ""))}">${esc(book.phone)}</a></div>`);
  if (book.email) lines.push(`<div>✉ <a href="mailto:${esc(book.email)}">${esc(book.email)}</a></div>`);
  if (book.website) lines.push(`<div>↗ <a href="${esc(/^https?:/.test(book.website) ? book.website : "https://" + book.website)}" target="_blank" rel="noopener">${esc(book.website)}</a></div>`);
  if (book.note) lines.push(`<div class="hint">${esc(book.note)}</div>`);
  const ksh = shotOk(S.detailKey)?.kontakt || x.contact_shots || {};
  if (ksh.name) lines.push(`<div>${esc(ksh.name)} <span class="hint">(aus Screenshot)</span></div>`);
  if (ksh.telefon && !book.phone) lines.push(`<div>☎ <a href="tel:${esc(String(ksh.telefon).replace(/\s/g, ""))}">${esc(ksh.telefon)}</a> <span class="hint">(aus Screenshot)</span></div>`);
  if (ksh.mail && !book.email) lines.push(`<div>✉ <a href="mailto:${esc(ksh.mail)}">${esc(ksh.mail)}</a> <span class="hint">(aus Screenshot)</span></div>`);
  (c.phones || []).forEach((p) => lines.push(`<div>☎ <a href="tel:${esc(p.replace(/\s/g, ""))}">${esc(p)}</a> <span class="hint">(aus dem Inserat)</span></div>`));
  (c.emails || []).forEach((m) => lines.push(`<div>✉ <a href="mailto:${esc(m)}">${esc(m)}</a> <span class="hint">(aus dem Inserat)</span></div>`));
  if (d?.apply_url && a?.online !== "offline") lines.push(`<a class="btn" href="${esc(d.apply_url)}" target="_blank" rel="noopener">Bewerbungs- / Kontaktformular öffnen ↗</a>`);
  const bookForm = ag ? `<details class="adv-inner"><summary>${book.phone || book.email || book.website ? "Kontakt der Verwaltung bearbeiten" : "Telefon / E-Mail der Verwaltung ergänzen"}</summary>
      <p class="hint">Gilt für alle Wohnungen von «${esc(ag.name)}», auch künftige.</p>
      <label class="f">Telefon<input class="field" id="agPhone" type="tel" value="${esc(book.phone || "")}"></label>
      <label class="f">E-Mail<input class="field" id="agEmail" type="email" value="${esc(book.email || "")}"></label>
      <label class="f">Website<input class="field" id="agWeb" type="url" value="${esc(book.website || "")}"></label>
      <label class="f">Notiz<input class="field" id="agNote" type="text" value="${esc(book.note || "")}" placeholder="z.B. Frau Muster, Vermietung"></label>
      <button type="button" class="btn primary" id="agSave" data-ag="${esc(ag.name)}">Im Adressbuch speichern</button></details>` : "";
  const desc = (d?.description || x.text || "").replace(/\*\*/g, "").replace(/\s*\|\s*/g, "\n").trim();
  const attrs = (d?.attributes || []).map((t) => `<span>${esc(ATTR[t] || t)}</span>`).join("");
  const docs = (d?.documents || []).map((doc) => doc.file ? `<a href="#" data-doc="archiv/${esc(a.id)}/${esc(doc.file)}">📄 ${esc(doc.title || "Dokument")}</a>`
    : doc.url ? `<a href="${esc(doc.url)}" target="_blank" rel="noopener">📄 ${esc(doc.title || "Dokument")} (online)</a>` : "").join("");
  const mail = d?.mail ? `<span class="hint">Aus der Abo-Mail «${esc(d.mail.subject)}»</span>` : "";
  const quarter = QUARTER[x.plz] || x.city || "";
  const portal = x.sources?.[0]?.portal || x.portal || "";
  const sub = [quarter, portal ? `auf ${portal} ${ago(x.published || x.first_seen)}` : "", a?.online === "online" ? "noch online" : a?.online === "offline" ? "offline" : a?.online === "reserviert" ? "reserviert" : ""].filter(Boolean).join(" · ");
  const ai = x.ai?.text ? `<div class="aibox"><small>✦ Claude</small><span>${esc(x.ai.text)}</span>${(x.ai.haken || []).length ? `<span class="hk">${esc(x.ai.haken.join(" · "))}</span>` : ""}</div>` : "";
  // v105 (Pascal 17.11.): zuerst «Wollen wir die?» (Fotos, Eckdaten, Lage, Claude, Daumen), dann zwei Reiter
  // «Wohnung» (Inserat, Kontakt der Verwaltung) und «Bewerben» (Schritte, Kontakt, Notizen). Chat als schwebender Knopf (chat.js).
  const pg = dPageOf(S.detailKey);
  $("dBody").innerHTML = `
    ${gal}
    <div class="dhead"><h1>${esc(placeName(x))}</h1><div class="sub">${esc(sub)}</div></div>
    ${facts}
    ${x.lat != null ? `<div class="detail-mini">${miniMap(x)}</div>` : ""}
    ${ai}
    ${votePanel(S.detailKey, x)}
    <div class="dpg-tabs" role="tablist" aria-label="Wohnung oder Bewerben">
      <button type="button" role="tab" data-dpg="wohnung" aria-selected="${pg === "wohnung"}">Wohnung</button>
      <button type="button" role="tab" data-dpg="bewerben" aria-selected="${pg === "bewerben"}">Bewerben${stepsDoneText(S.detailKey)}</button></div>
    <div class="dpg" id="dPgBewerben" ${pg === "bewerben" ? "" : "hidden"}>
    ${standPanel(S.detailKey)}
    <div class="panel"><h2>Kontakt</h2><div class="contact">${lines.join("") || '<p class="hint">Keine Angaben.</p>'}${bookForm}</div></div>
    ${usPanel(S.detailKey)}
    </div>
    <div class="dpg" id="dPgWohnung" ${pg === "wohnung" ? "" : "hidden"}>
    ${desc || attrs ? `<div class="panel"><h2>Beschreibung</h2>${desc ? `<div class="desc clamp" id="dDesc">${esc(desc)}</div><button type="button" class="linkbtn" id="dDescMore" style="justify-self:start">Mehr lesen</button>` : ""}${attrs ? `<div class="chips2">${attrs}</div>` : ""}</div>` : ""}
    ${searchPanel(x)}
    ${docs ? `<div class="panel doclist"><h2>Dokumente</h2>${docs}</div>` : ""}
    ${firstUrl(x) ? `<a class="linkbtn" style="justify-self:center" href="${esc(goodUrl(x))}" target="_blank" rel="noopener">${goodSource(x) ? `Inserat auf ${esc(goodSource(x).portal || portalOf(goodSource(x).url))} öffnen ↗` : `Auf Comparis suchen ↗`}</a>` : ""}
    ${onl || '<div class="onl">Noch nicht gesichert. Neue Treffer, Favoriten und Wohnungen mit Stand sichert Wollihood beim nächsten Suchlauf.</div>'}
    <div class="srcs" style="padding:0">Gefunden auf: ${sourcesHtml(x)}${mail ? " · " + mail : ""}${(x.notes || []).length ? `<br>${esc(x.notes.join(" · "))}` : ""}</div>
    </div>`;
  const dm = $("dBody").querySelector(".mini"); if (dm) setTimeout(() => initMini(dm), 60);
  const dd = $("dDesc"); if (dd) setTimeout(() => { if (dd.scrollHeight <= dd.clientHeight + 4) $("dDescMore")?.remove(); }, 30);
  // Bilder aus dem privaten Repo nachladen
  $("dBody").querySelectorAll("img[data-src]").forEach((img) => repoFile(img.dataset.src).then((u) => (img.src = u)).catch(() => img.closest("figure")?.remove()));
  S.detailData = d;
  afterStand(S.detailKey); chatLoad(S.detailKey); festCheck(S.detailKey);
}
// ---------- Eigene Dateien, Notiz, «Teilen → Wollihood» ----------
async function aidOf(k) {
  const a = S.archive[k] || Object.values(S.archive).find((v) => (v.keys || []).includes(k));
  if (a) return a.id;
  const h = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(k));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
async function shrinkImage(file) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), "image/jpeg", 0.82));
  } catch { return file; }
}
const blobB64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
async function uploadOwn(k, files, note) {
  if (needPerson()) return 0;
  const x = S.hits.find((h) => keyOf(h) === k) || {}, aid = await aidOf(k);
  const added = [];
  for (const [i, f] of [...files].entries()) {
    if (f.size > 12e6) { toast(`«${f.name}» ist zu gross (max. 12 MB).`, "err"); continue; }
    const blob = await shrinkImage(f);
    const pdf = (f.type || blob.type) === "application/pdf";
    const path = `archiv/${aid}/eigene/${Date.now().toString(36)}_${i}.${pdf ? "pdf" : "jpg"}`;
    try {
      await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Eigene Datei: ${x.street || k}`, content: await blobB64(blob), branch: "main" }) });
      added.push({ path, name: f.name || "Datei", type: pdf ? "application/pdf" : "image/jpeg", by: S.person, at: new Date().toISOString() });
    } catch (e) { toast("Hochladen fehlgeschlagen: " + e.message, "err"); }
  }
  if (added.length || note) {
    socialOp(`${PEOPLE[S.person]} ergänzt (${x.street || "Inserat"})`, (items) => {
      const it = items[k] || (items[k] = { votes: {} });
      if (added.length) it.files = [...(it.files || []), ...added];
      if (note) it.note = [it.note, note].filter(Boolean).join("\n");
      it.updated = new Date().toISOString();
    });
  }
  return added.length;
}
async function refreshDetail() {
  if ($("detail").hidden || !S.detailKey) return;
  const x = S.hits.find((h) => keyOf(h) === S.detailKey) || {}; const a = archEntry(x);
  let d = null; if (a) { try { d = (await readJson(`archiv/${a.id}/data.json`)).data; } catch {} }
  renderDetail(x, a, d);
}
$("dBody").addEventListener("change", (e) => {
  const k = S.detailKey; if (!k) return;
  if (e.target.matches("[data-swhen]")) { setStep(k, "besichtigung", { when: e.target.value ? new Date(e.target.value).toISOString() : null }); return; }
});
$("dBody").addEventListener("change", async (e) => {
  if (e.target.id !== "ownFiles" || !e.target.files.length) return;
  toast("Lade hoch …", "", 0);
  const k = S.detailKey, imgs = [...e.target.files].filter((f) => f.type.startsWith("image/"));
  const n = await uploadOwn(k, e.target.files);
  toast(n ? `${n} Datei${n > 1 ? "en" : ""} gespeichert.` : "Nichts gespeichert.", n ? "ok" : "err");
  setTimeout(refreshDetail, 300);
  if (n && imgs.length && await kiKey()) setTimeout(() => shotsRun(k, imgs), 400);   // Claude liest gleich mit
});
// ---------- Angaben aus Screenshots (v79, Pascal 2.11.) ----------
// Claude liest die Screenshots einer Wohnung, ergänzt Angaben und Kontakt und schneidet die Fotos aus.
// Vorschlag in social[k].shots (status «vorschlag»), «Übernehmen» → status «ok» → Suchskript (wollihood/shots.py) übernimmt.
const SHOT_FIELDS = [["strasse", "Strasse", "text"], ["plz", "PLZ", "text"], ["ort", "Ort", "text"], ["zimmer", "Zimmer", "number"],
  ["miete_brutto", "Miete brutto (CHF)", "number"], ["flaeche_m2", "Fläche (m²)", "number"], ["etage", "Etage", "text"],
  ["bezug", "Bezug", "text"], ["befristung", "Befristung", "text"]];
const SHOT_KONTAKT = [["firma", "Verwaltung"], ["name", "Kontaktperson"], ["telefon", "Telefon"], ["mail", "E-Mail"]];
const SHOT_PREV = { strasse: "street", plz: "plz", ort: "city", zimmer: "rooms", miete_brutto: "rent", flaeche_m2: "m2", etage: "floor_text", bezug: "moving_date_text", befristung: "limited_text" };
const SHOT_TOOL = { name: "screenshots", description: "Angaben, Kontakt und Fotos aus Screenshots eines Wohnungsinserats.",
  input_schema: { type: "object", properties: {
    angaben: { type: "object", properties: {
      strasse: { type: "string", description: "Strasse und Hausnummer" }, plz: { type: "string" }, ort: { type: "string" },
      zimmer: { type: "number" }, miete_brutto: { type: "number", description: "Monatsmiete inkl. Nebenkosten in CHF; steht nur netto + NK, die Summe" },
      miete_netto: { type: "number" }, nebenkosten: { type: "number" }, flaeche_m2: { type: "number" },
      etage: { type: "string", description: "z.B. «2. OG», «EG»" }, bezug: { type: "string", description: "z.B. «per 1.12.2026», «sofort», «nach Vereinbarung»" },
      befristung: { type: "string", description: "nur wenn befristet, z.B. «bis 31.3.2028»" },
      text: { type: "string", description: "das Wichtigste aus dem Inseratetext in 1–3 Sätzen, sachlich, max. 400 Zeichen" } } },
    kontakt: { type: "object", properties: { firma: { type: "string", description: "Verwaltung/Vermieter-Firma" }, name: { type: "string" },
      telefon: { type: "string" }, mail: { type: "string" } } },
    fotos: { type: "array", description: "Wohnungsfotos und Grundrisse in den Screenshots, max. 8", items: { type: "object", properties: {
      bild: { type: "integer", description: "Nummer des Screenshots, 1 = erster" },
      x0: { type: "integer", description: "linker Rand, 0–1000 (Anteil der Bildbreite)" }, y0: { type: "integer", description: "oberer Rand, 0–1000 (Anteil der Bildhöhe)" },
      x1: { type: "integer" }, y1: { type: "integer" }, art: { type: "string", enum: ["foto", "grundriss"] },
      muster: { type: "boolean", description: "true, wenn das Inserat sagt, es seien Muster-/Symbolfotos (z.B. Ausbaustandard)" } },
      required: ["bild", "x0", "y0", "x1", "y1"] } } },
    required: ["angaben"] } };
const SHOT_PROMPT = `Das sind Screenshots eines Wohnungsinserats (Homegate, Comparis, Flatfox o.ä., meist vom Handy).
Gib mit dem Werkzeug «screenshots» zurück, was SICHTBAR ist – nichts erfinden, nichts schätzen; Unsichtbares weglassen.
Fotos: Rahmen jedes echten Wohnungsfotos (Räume, Haus, Aussicht, Balkon) und jedes Grundrisses, so knapp wie möglich am Bildrand,
ohne Bedienelemente, Text, Statusleiste, Knöpfe. Koordinaten als Anteil 0–1000 der Bildbreite (x) und Bildhöhe (y) des jeweiligen Screenshots.
Auch Musterfotos des Ausbaustandards nehmen (dann muster: true) – lieber ein Musterfoto als gar keines.
Nicht nehmen: Karten, Logos, Profilbilder, Werbung, Fotos, die zu mehr als einem Fünftel abgeschnitten
oder schmaler als ein Fünftel der Bildbreite sind. Dasselbe Foto (z.B. in einer Bildergalerie mehrfach gescreenshottet) nur einmal.
Wenn in den Screenshots Fotos sichtbar sind, gib sie IMMER im Feld «fotos» zurück.`;
S.shotBusy = {};
function shotsBox(k) {
  const it = itemOf(k), sh = it.shots, x = hitByKey(k) || {};
  const hasImgs = (it.files || []).some((f) => f.type !== "application/pdf");
  if (S.shotBusy[k]) return `<div class="shotbox"><p class="hint">✦ ${esc(S.shotBusy[k])}</p></div>`;
  if (sh && sh.status === "vorschlag") {
    const a = sh.angaben || {}, kt = sh.kontakt || {};
    const rows = SHOT_FIELDS.filter(([f]) => a[f] != null && a[f] !== "").map(([f, l, t]) => {
      const prev = x[SHOT_PREV[f]];
      const diff = prev != null && prev !== "" && String(prev) !== String(a[f]);
      return `<label class="f"><small>${l}${diff ? ` · bisher ${esc(prev)}` : prev == null || prev === "" ? " · neu" : ""}</small><input class="field" type="${t}" step="any" data-shf="${f}" value="${esc(a[f])}"></label>`; }).join("");
    const krows = SHOT_KONTAKT.filter(([f]) => kt[f]).map(([f, l]) => `<label class="f"><small>${l}</small><input class="field" data-shk="${f}" value="${esc(kt[f])}"></label>`).join("");
    const fotos = (sh.fotos || []).map((f, i) => `<label class="shotfoto"><input type="checkbox" data-shfoto="${i}" checked><img data-src="${esc(f.path)}" alt=""></label>`).join("");
    return `<div class="shotbox"><h3>✦ Aus Screenshots gelesen</h3>
      <p class="hint">Prüfen, ändern, dann übernehmen. Wollihood verortet die Wohnung danach neu und sucht sie auf den anderen Plattformen.</p>
      ${rows ? `<div class="shotgrid">${rows}</div>` : '<p class="hint">Keine Angaben gefunden.</p>'}${a.text ? `<label class="f"><small>Aus dem Text</small><textarea class="field" rows="3" data-shf="text">${esc(a.text)}</textarea></label>` : ""}
      ${krows ? `<h4>Kontakt</h4><div class="shotgrid">${krows}</div>` : ""}
      ${fotos ? `<h4>Fotos (${(sh.fotos || []).length}) – antippen zum Weglassen</h4><div class="shotfotos">${fotos}</div>` : ""}
      <div class="kbar"><button type="button" class="btn sm" data-shot="drop">Verwerfen</button><button type="button" class="btn sm primary" data-shot="ok">Übernehmen</button></div></div>`;
  }
  if (sh && sh.status === "ok") return `<p class="hint shotline">✦ Aus Screenshots ergänzt · ${esc(PEOPLE[sh.by] || "")} ${esc(dmy(sh.at))}${hasImgs ? ` · <button type="button" class="linkbtn" data-shot="read">nochmals lesen</button>` : ""}</p>`;
  if (sh && sh.error) return `<p class="hint shotline">Claude konnte die Screenshots nicht lesen: ${esc(sh.error)}${hasImgs ? ` · <button type="button" class="linkbtn" data-shot="read">nochmals</button>` : ""}</p>`;
  return hasImgs ? `<button type="button" class="linkbtn" data-shot="read" style="justify-self:start">✦ Angaben und Fotos aus den Screenshots holen</button>` : "";
}
async function fileFromRepo(path) { const u = await repoFile(path); const b = await (await fetch(u)).blob(); return new File([b], path.split("/").pop(), { type: b.type || "image/jpeg" }); }
async function cropUpload(k, file, box, n) {
  const bmp = await createImageBitmap(file);
  const cl = (v) => Math.max(0, Math.min(1000, Number(v) || 0));
  let x0 = cl(box.x0) / 1000 * bmp.width, x1 = cl(box.x1) / 1000 * bmp.width, y0 = cl(box.y0) / 1000 * bmp.height, y1 = cl(box.y1) / 1000 * bmp.height;
  const w = x1 - x0, h = y1 - y0;
  if (w < 160 || h < 120 || w < bmp.width * 0.18) return null;            // zu klein → lieber weglassen
  const ix = w * 0.01, iy = h * 0.01; x0 += ix; x1 -= ix; y0 += iy; y1 -= iy;  // Ränder/Schatten wegschneiden
  const scale = Math.min(1, 1400 / Math.max(x1 - x0, y1 - y0));
  const c = document.createElement("canvas"); c.width = Math.round((x1 - x0) * scale); c.height = Math.round((y1 - y0) * scale);
  c.getContext("2d").drawImage(bmp, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  const aid = await aidOf(k), path = `archiv/${aid}/eigene/foto_${Date.now().toString(36)}_${n}.jpg`;
  await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Foto aus Screenshot", content: await blobB64(blob), branch: "main" }) });
  fileCache.set(path, Promise.resolve(URL.createObjectURL(blob)));
  return { path, art: box.art || "foto", muster: !!box.muster, w: c.width, h: c.height };
}
async function shotsRun(k, files) {
  if (needPerson() || S.shotBusy[k]) return;
  const key = await kiKey();
  if (!key) { toast("Kein Claude-Schlüssel (Mehr → «Claude für Bewerbungen»).", "err"); return; }
  const set = (t) => { S.shotBusy[k] = t; if (S.detailKey === k) refreshUs(); };
  try {
    set("Claude liest die Screenshots …");
    if (!files) files = await Promise.all((itemOf(k).files || []).filter((f) => f.type !== "application/pdf").slice(-8).map((f) => fileFromRepo(f.path)));
    files = [...files].filter((f) => (f.type || "").startsWith("image/")).slice(0, 8);
    const content = [];
    for (const f of files) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobB64(await shrinkImage(f)) } });
    const x = hitByKey(k) || {};
    content.push({ type: "text", text: SHOT_PROMPT + `\n\nBisher bekannt: ${JSON.stringify({ strasse: x.street, plz: x.plz, zimmer: x.rooms, miete: x.rent, m2: x.m2 })}` });
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: S.config?.ai?.model || "claude-opus-5-5", max_tokens: 3000, tools: [SHOT_TOOL], tool_choice: { type: "auto" },
        messages: [{ role: "user", content }] }) });
    let j = {}; try { j = await r.json(); } catch { }
    if (!r.ok) throw new Error(r.status === 401 ? "Der Claude-Schlüssel ist ungültig." : j?.error?.message || `Fehler ${r.status}`);
    const res = (j.content || []).find((b) => b.type === "tool_use")?.input;
    if (!res) throw new Error("Claude hat nicht im erwarteten Format geantwortet.");
    const fotos = [];
    const boxes = (res.fotos || []).slice(0, 8);
    for (const [i, b] of boxes.entries()) {
      const f = files[(b.bild || 1) - 1]; if (!f) continue;
      set(`Schneide Fotos aus … ${i + 1}/${boxes.length}`);
      try { const c = await cropUpload(k, f, b, i); if (c) fotos.push(c); } catch (e) { console.warn("Ausschnitt", e); }
    }
    const angaben = {}; for (const [f, v] of Object.entries(res.angaben || {})) if (v != null && v !== "" && v !== 0) angaben[f] = v;
    const kontakt = {}; for (const [f, v] of Object.entries(res.kontakt || {})) if (v) kontakt[f] = v;
    delete S.shotBusy[k];
    socialOp(`${PEOPLE[S.person]}: Screenshots gelesen (${x.street || "Inserat"})`, (items) => {
      const it = items[k] || (items[k] = { votes: {} });
      it.shots = { status: "vorschlag", angaben, kontakt, fotos, quellen: files.map((f) => f.name).filter(Boolean), by: S.person, at: new Date().toISOString() };
    });
    toast("Claude hat die Screenshots gelesen – bitte prüfen.", "ok");
  } catch (e) {
    delete S.shotBusy[k];
    socialOp("Screenshots: Fehler", (items) => { const it = items[k] || (items[k] = { votes: {} }); it.shots = { status: "fehler", error: e.message, at: new Date().toISOString() }; });
    toast("Claude: " + e.message, "err", 7000);
  }
  if (S.detailKey === k) setTimeout(refreshUs, 50);
}
// bestätigte Angaben sofort in der Liste zeigen (das Suchskript schreibt sie beim nächsten Lauf fest)
function shotOverlay(x) {
  const sh = shotOk(keyOf(x)); if (!sh) return x;
  const a = sh.angaben || {};
  for (const [f, dst] of Object.entries(SHOT_PREV)) if (a[f] != null && a[f] !== "") x[dst] = ["zimmer", "miete_brutto", "flaeche_m2"].includes(f) ? Number(a[f]) : a[f];
  if (sh.kontakt?.firma && !x.agency) x.agency = sh.kontakt.firma;
  if (a.text && !(x.text || "").includes(a.text)) x.text = a.text + "\n\n" + (x.text || "");
  return x;
}
async function agencyAdd(name, kt) {
  const k = agencyKey(name); if (!k) return;
  for (let i = 0; i < 4; i++) {
    try {
      let cur = { data: { agencies: {} }, sha: S.agenciesSha };
      try { cur = await readJson("agencies.json"); } catch (er) { if (er.status !== 404) throw er; }
      const all = cur.data.agencies || {}, e = all[k] || { name };
      if (!e.phone && kt.telefon) e.phone = kt.telefon;
      if (!e.email && kt.mail) e.email = kt.mail;
      if (!e.note && kt.name) e.note = kt.name;
      all[k] = e;
      S.agenciesSha = await writeJson("agencies.json", { agencies: all }, cur.sha, `Adressbuch: ${name} (aus Screenshot)`);
      S.agencies = all; return;
    } catch (er) { if (!(er.status === 409 || er.status === 422) || i === 3) return; }
  }
}
$("dBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-shot]"); if (!b || !S.detailKey) return;
  const k = S.detailKey, act = b.dataset.shot;
  if (act === "read") { shotsRun(k); return; }
  if (needPerson()) return;
  if (act === "drop") {
    socialOp(`${PEOPLE[S.person]}: Screenshot-Angaben verworfen`, (items) => { const it = items[k]; if (it?.shots) it.shots = { status: "verworfen", by: S.person, at: new Date().toISOString() }; });
    setTimeout(refreshUs, 50); return;
  }
  const box = b.closest(".shotbox"), sh = itemOf(k).shots || {};
  const angaben = { ...(sh.angaben || {}) }, kontakt = { ...(sh.kontakt || {}) };
  box.querySelectorAll("[data-shf]").forEach((el) => { const v = el.value.trim(); if (v) angaben[el.dataset.shf] = el.type === "number" ? Number(v) : v; else delete angaben[el.dataset.shf]; });
  box.querySelectorAll("[data-shk]").forEach((el) => { const v = el.value.trim(); if (v) kontakt[el.dataset.shk] = v; else delete kontakt[el.dataset.shk]; });
  const keep = new Set([...box.querySelectorAll("[data-shfoto]")].filter((c) => c.checked).map((c) => Number(c.dataset.shfoto)));
  const fotos = (sh.fotos || []).filter((_, i) => keep.has(i));
  const ok = { status: "ok", angaben, kontakt, fotos, quellen: sh.quellen || [], by: S.person, at: new Date().toISOString() };
  socialOp(`${PEOPLE[S.person]}: Angaben aus Screenshots übernommen`, (items) => { const it = items[k] || (items[k] = { votes: {} }); it.shots = ok; it.updated = ok.at; });
  if (kontakt.firma && (kontakt.telefon || kontakt.mail)) agencyAdd(kontakt.firma, kontakt);
  const x = hitByKey(k); if (x) shotOverlay(x);
  toast("Übernommen. Wollihood ergänzt den Rest beim nächsten Suchlauf.", "ok");
  setTimeout(refreshDetail, 80); renderHits();
});
