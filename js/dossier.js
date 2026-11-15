"use strict";
// --- Dazulernen aus Änderungen von Hand ---
const LERN_PATH = "dossier/stil/gelernt.json", FERTIG_PATH = "dossier/stil/fertige.json";
const LERN_SYSTEM = `Du lernst den Schreibstil von Leonie und Pascal für Wohnungsbewerbungen.
Du bekommst eine Fassung (vorher, meist von Claude) und ihre von Hand bearbeitete Fassung (nachher).
Leite daraus allgemeine Schreibregeln ab, die auch für künftige Bewerbungen gelten: Wortwahl, Ton, typische Formulierungen,
was sie streichen, ergänzen oder umstellen, Länge, Zeichensetzung.
Keine Regeln zu Inhalten, die nur diese Wohnung betreffen (Adresse, was ihnen gefallen hat, Ansprechperson, Bezugstermin)
und keine einmaligen Fakten. Keine Regeln, die es schon gibt. Jede Regel als kurzer Satz in der Befehlsform auf Deutsch
(Schweizer Schreibweise), dazu ein Beispiel «vorher → nachher». Höchstens 4 Regeln. Wenn nichts Allgemeines erkennbar ist,
gib eine leere Liste zurück. Antworte nur mit dem Werkzeug «regeln».`;
const LERN_TOOL = { name: "regeln", description: "Allgemeine Schreibregeln aus den Änderungen von Hand.",
  input_schema: { type: "object", required: ["regeln"], properties: { regeln: { type: "array",
    items: { type: "object", required: ["regel"], properties: { regel: { type: "string" }, beispiel: { type: "string" } } } } } } };
function bewLearnMaybe() {
  bewRead();
  const base = BEW.doc.ki, cur = { text: BEW.doc.text, bemerkung: BEW.doc.bemerkung || "" };
  if (!base || !BEW.ctx?.key) return;
  if (base.text === cur.text && (base.bemerkung || "") === cur.bemerkung) return;
  BEW.doc.ki = { ...cur, at: new Date().toISOString() };   // neue Basis: dieselben Änderungen nicht nochmals lernen
  const part = (t, a, b) => (a || "") === (b || "") ? "" : `--- ${t} vorher ---\n${a || "(leer)"}\n--- ${t} nachher ---\n${b || "(leer)"}\n\n`;
  const user = `<bestehende_regeln>\n${(BEW.ctx.regeln || []).map((r) => "- " + r.regel).join("\n") || "(noch keine)"}\n</bestehende_regeln>\n\n<aenderungen>\n${part("Anschreiben", base.text, cur.text)}${part("Bemerkung", base.bemerkung, cur.bemerkung)}</aenderungen>`;
  claudeTool(LERN_SYSTEM, user, LERN_TOOL, "regeln").then((res) => {
    const neu = (res.regeln || []).filter((r) => r && r.regel).slice(0, 4);
    if (!neu.length || !bewActive()) return;
    BEW.learn = neu; bewLearnShow();
    toast("Claude hat aus euren Änderungen etwas gelernt – bitte bestätigen.", "", 6000);
  }).catch(() => { });
}
function bewLearnShow() {
  const L = BEW.learn || [];
  $("bLearn").innerHTML = !L.length ? "" : `<div class="learn"><div class="ftitle sm">Das habe ich aus euren Änderungen gelernt – merken?</div>
    ${L.map((r, i) => `<label class="lrule"><input type="checkbox" data-lr="${i}" checked><span>${esc(r.regel)}${r.beispiel ? `<small>${esc(r.beispiel)}</small>` : ""}</span></label>`).join("")}
    <div class="brow"><button type="button" class="btn primary" id="bLearnOk">Merken</button><button type="button" class="btn" id="bLearnNo">Verwerfen</button></div></div>`;
  $("bLearn").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
async function bewLearnDecide(ok) {
  const pick = ok ? [...document.querySelectorAll("#bLearn [data-lr]")].filter((c) => c.checked).map((c) => BEW.learn[+c.dataset.lr]) : [];
  BEW.learn = null; $("bLearn").innerHTML = "";
  if (!pick.length) return;
  try {
    await lernSave((list) => list.concat(pick.map((r) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      regel: r.regel, beispiel: r.beispiel || "", by: S.person, at: new Date().toISOString() }))), "Schreibregel gelernt");
    toast(pick.length === 1 ? "Regel gemerkt." : `${pick.length} Regeln gemerkt.`, "ok");
  } catch (e) { toast("Merken fehlgeschlagen: " + e.message, "err"); }
}
async function lernSave(fn, msg) {
  let sha = null, data = { regeln: [] };
  try { const r = await readJson(LERN_PATH); sha = r.sha; data = r.data; } catch (e) { if (e.status !== 404) throw e; }
  data.regeln = fn(data.regeln || []);
  await writeJson(LERN_PATH, data, sha, msg);
  if (BEW.ctx) BEW.ctx.regeln = data.regeln;
  lernList(data.regeln);
}
async function bewFertig() {
  let sha = null, data = { anschreiben: [] };
  try { const r = await readJson(FERTIG_PATH); sha = r.sha; data = r.data; } catch (e) { if (e.status !== 404) throw e; }
  const list = (data.anschreiben || []).filter((f) => f.adresse !== BEW.doc.adresse);
  list.unshift({ adresse: BEW.doc.adresse, text: BEW.doc.text, at: new Date().toISOString() });
  data.anschreiben = list.slice(0, 5);
  await writeJson(FERTIG_PATH, data, sha, `Fertiges Anschreiben: ${BEW.doc.adresse}`);
  BEW.ctx.fertige = data.anschreiben;
}
async function bewGrundtext() {
  bewRead();
  if (!confirm("Diese Fassung wird zum Grundtext für alle künftigen Bewerbungen. Adresse und Wohnungsspezifisches passt Claude beim nächsten Entwurf wieder an. Übernehmen?")) return;
  try {
    const r = await readJson("dossier/vorlage/anschreiben.json");
    const street = (BEW.x.street || "").trim();
    let text = BEW.doc.text;
    if (street) text = text.split(street).join("[Strasse Nr.]");
    r.data.text = text; r.data.grundtext_von = { adresse: BEW.doc.adresse, by: S.person, at: new Date().toISOString() };
    await writeJson("dossier/vorlage/anschreiben.json", r.data, r.sha, `Neuer Grundtext (aus ${BEW.doc.adresse})`);
    BEW.ctx.vorlage = r.data;
    toast("Grundtext übernommen.", "ok");
  } catch (e) { toast("Übernehmen fehlgeschlagen: " + e.message, "err"); }
}
// Optionen: gelernte Regeln ansehen, löschen, eigene ergänzen
function lernList(list) {
  if (!$("lernList")) return;
  $("lernList").innerHTML = (list || []).length ? list.map((r) => `<div class="lrow"><span>${esc(r.regel)}${r.beispiel ? `<small>${esc(r.beispiel)}</small>` : ""}</span>
    <button type="button" class="iconbtn" data-lrdel="${esc(r.id)}" aria-label="Regel löschen">✕</button></div>`).join("")
    : '<p class="hint">Noch keine. Sobald ihr Claudes Text von Hand ändert, schlägt Claude hier Regeln vor.</p>';
}
async function lernLoad() { try { lernList((await readJson(LERN_PATH)).data.regeln); } catch { lernList([]); } }
$("lernList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-lrdel]"); if (!b || !confirm("Diese Regel löschen?")) return;
  try { await lernSave((l) => l.filter((r) => r.id !== b.dataset.lrdel), "Schreibregel gelöscht"); toast("Gelöscht.", "ok"); } catch (e2) { toast(e2.message, "err"); }
});
$("lernAdd").addEventListener("click", async () => {
  const t = $("lernNew").value.trim(); if (!t) return;
  try { await lernSave((l) => l.concat([{ id: Date.now().toString(36), regel: t, beispiel: "", by: S.person, at: new Date().toISOString() }]), "Schreibregel ergänzt");
    $("lernNew").value = ""; toast("Regel ergänzt.", "ok"); } catch (e) { toast(e.message, "err"); }
});

// --- PDF auf der Canva-Vorlage (Masse aus der Vorlage gemessen, wie tools/anschreiben.py im privaten Repo) ---
const PDFLIBS = ["https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
  "https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js"];
function loadScript(src) { return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("Bibliothek nicht ladbar")); document.head.appendChild(s); }); }
async function pdfLibs() { if (!window.PDFLib) await loadScript(PDFLIBS[0]); if (!window.fontkit) await loadScript(PDFLIBS[1]); }
async function repoBytes(path) { const u = await repoFile(path); return new Uint8Array(await (await fetch(u)).arrayBuffer()); }
const LAY = { x0: 26.05, xmax: 557.5, xmaxSchluss: 300, size: 12, lead: 16.5, firstTop: 287.2, base: 833.775, bodyMax: 650, pageMax: 800,
  adrX: 278.06, adrY: 681.492, adrSize: 15.01, kontaktTop: 753.6, iconX: 360, textX: 375.5,
  blob: [150 / 255, 180 / 255, 209 / 255], ink: [0.098, 0.1059, 0.1373], mark: [0.30, 0.45, 0.62] };
const ICON_MAIL = ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M22 7l-8.991 5.727a2 2 0 0 1-2.009 0L2 7"];
const ICON_TEL = ["M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"];
function splitParas(text) {
  const paras = text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let g = -1; paras.forEach((p, i) => { if (/^(Freundliche|Herzliche|Liebe|Beste|Viele)\s+Grüsse/i.test(p)) g = i; });
  if (g < 0) return { body: paras, schluss: [] };
  const s = g > 0 && paras[g - 1].length < 120 ? g - 1 : g;
  return { body: paras.slice(0, s), schluss: paras.slice(s) };
}
function layoutPdf(doc, fonts) {
  // liefert Zeilen [{top, x, segs:[{t, mark}]}] und Warnungen
  const { R, I } = fonts, w = (t, mark) => (mark ? I : R).widthOfTextAtSize(t, LAY.size);
  const lines = [], warn = [];
  let top = LAY.firstTop, inPh = false;
  const wrapLine = (txt, maxW) => {
    const words = txt.split(/\s+/).filter(Boolean), out = []; let cur = "";
    for (const wd of words) { const t = cur ? cur + " " + wd : wd; if (R.widthOfTextAtSize(t, LAY.size) <= maxW || !cur) cur = t; else { out.push(cur); cur = wd; } }
    if (cur) out.push(cur); return out;
  };
  const pushLine = (txt) => {
    const segs = []; let buf = "";
    for (const ch of txt) {
      if (ch === "[") { if (buf) segs.push({ t: buf, mark: inPh }); buf = "["; inPh = true; }
      else if (ch === "]") { buf += "]"; segs.push({ t: buf, mark: true }); buf = ""; inPh = false; }
      else buf += ch;
    }
    if (buf) segs.push({ t: buf, mark: inPh });
    lines.push({ top, segs }); top += LAY.lead;
  };
  const para = (p, maxW) => { p.split("\n").forEach((l) => wrapLine(l.trim(), maxW).forEach(pushLine)); top += LAY.lead; };
  const { body, schluss } = splitParas(doc.text);
  if (anredeZeile(doc.anrede, doc.name)) para(anredeZeile(doc.anrede, doc.name), LAY.xmax - LAY.x0);
  body.forEach((p) => para(p, LAY.xmax - LAY.x0));
  if (top - LAY.lead > LAY.bodyMax) warn.push("Der Haupttext ist zu lang und läuft in die blaue Fläche. Bitte kürzen.");
  schluss.forEach((p) => para(p, LAY.xmaxSchluss - LAY.x0));
  if (top - LAY.lead > LAY.pageMax) warn.push("Der Text passt nicht auf die Seite. Bitte kürzen.");
  lines.forEach((l) => l.segs.forEach((s) => (s.w = w(s.t, s.mark))));
  return { lines, warn };
}
async function bewPdfStore() {
  const bytes = await anschreibenBytes(false); if (!bytes) return;
  const blob = new Blob([bytes], { type: "application/pdf" }), path = bewPath("Anschreiben.pdf");
  let sha; try { sha = (await gh(path)).sha; } catch { }
  await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Bewerbung PDF: ${BEW.x.street || BEW.k}`, content: await blobB64(blob), branch: "main", ...(sha ? { sha } : {}) }) });
  fileCache.delete(path); BEW.doc.pdf = path; BEW.doc.pdf_at = new Date().toISOString();
  bewLearnMaybe(); await bewSave(true); bewFertig().catch(() => { });
}
async function bewPdf() {
  bewRead();
  const offen = (BEW.doc.text + " " + BEW.doc.adresse + " " + BEW.doc.name).match(/\[[^\]]*\]/g);
  if (offen && !confirm(`Noch offen: ${offen.join(", ")}\n\nTrotzdem ein PDF erstellen (z.B. zum Testen)?`)) return;
  const btn = $("bPdf"); btn.disabled = true; btn.textContent = "Erstelle PDF …";
  try {
    await pdfAssets();
    const bytes = await anschreibenBytes(true); if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const name = "Wohnungsbewerbung_" + (BEW.x.street || "Wohnung").replace(/[^\wäöüÄÖÜ]+/g, "_") + ".pdf";
    const path = bewPath("Anschreiben.pdf");
    let sha; try { sha = (await gh(path)).sha; } catch { }
    await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `Bewerbung PDF: ${BEW.x.street || BEW.k}`, content: await blobB64(blob), branch: "main", ...(sha ? { sha } : {}) }) });
    fileCache.delete(path);
    BEW.doc.pdf = path; BEW.doc.pdf_at = new Date().toISOString();
    bewLearnMaybe();
    await bewSave(true);
    bewFertig().catch(() => { });
    const url = URL.createObjectURL(blob);
    $("bPdfLink").innerHTML = `<a class="doclink" href="${url}" target="_blank" rel="noopener">📄 PDF öffnen</a> <a class="doclink" href="${url}" download="${esc(name)}">⬇ Herunterladen</a>`;
    toast("PDF erstellt und gespeichert.", "ok");
  } catch (e) { toast("PDF fehlgeschlagen: " + e.message, "err"); }
  finally { btn.disabled = false; btn.textContent = "PDF ansehen"; }
}

// --- Foto im Anschreiben (v85, Pascal 14.11.: «wir machen gerne ein Foto vor dem Haus») ---
// Eigenes Foto pro Wohnung (oder als Standard für alle): Claude prüft es (Personen, Köpfe, Schärfe, Licht, Haus) und schlägt
// den Ausschnitt vor; im Browser verschieben/zoomen; gespeichert als runder PNG-Ausschnitt `bewerbung/foto.png`
// (+ Original foto-original.jpg), im PDF genau über das Kreisfoto der Vorlage gelegt.
const FOTO_CX = 136.875, FOTO_CY = 850.08 - 147.375, FOTO_R = 110.875 + 1.2;
const FOTO_TOOL = { name: "foto", description: "Prüfung eines Fotos für den runden Bildausschnitt im Bewerbungsschreiben.",
  input_schema: { type: "object", required: ["koepfe", "ausschnitt", "tauglich"], properties: {
    koepfe: { type: "array", description: "Rahmen um jeden Kopf (inkl. Haare) aller Personen, 0–1000 relativ zu Bildbreite (x) und -höhe (y)",
      items: { type: "object", required: ["x0", "y0", "x1", "y1"], properties: { x0: { type: "integer" }, y0: { type: "integer" }, x1: { type: "integer" }, y1: { type: "integer" } } } },
    ausschnitt: { type: "object", required: ["mitte_x", "mitte_y", "seite"], description: "Quadrat, in dem der Kreis liegt",
      properties: { mitte_x: { type: "integer", description: "0–1000 der Bildbreite" }, mitte_y: { type: "integer", description: "0–1000 der Bildhöhe" },
        seite: { type: "integer", description: "Seitenlänge als 0–1000 der kürzeren Bildseite" } } },
    tauglich: { type: "boolean", description: "Eignet sich das Foto für eine Bewerbung?" },
    hinweise: { type: "array", items: { type: "string" }, description: "höchstens 3 kurze, konkrete Hinweise (z.B. «Lio verdeckt halb Leonies Gesicht», «etwas dunkel»); leer, wenn alles gut" } } } };
const FOTO_PROMPT = `Dieses Foto von Leonie, Pascal und Lio soll oben links ins Bewerbungsschreiben, als runder Ausschnitt (Kreis, ca. 8 cm).
Prüfe es kritisch, wie eine Verwaltung es sehen würde: alle Personen gut erkennbar, Gesichter nicht verdeckt oder angeschnitten,
scharf, genug Licht, freundlich, nichts Störendes. Ist ein Haus/eine Fassade im Hintergrund, soll man es im Kreis noch erkennen.
Gib die Köpfe aller Personen als Rahmen zurück und schlage den Ausschnitt vor: ein Quadrat, dessen Innenkreis alle Köpfe
vollständig mit etwas Luft enthält (auch die Schultern), Köpfe eher in der oberen Hälfte, Personen füllen etwa 60–75 % der Breite,
sonst so viel Haus wie möglich. Nichts beschönigen, aber auch nichts erfinden.
Hinweise auf Deutsch in Schweizer Schreibweise (ss statt ß), je ein kurzer Satz, nur was wirklich zählt.`;
const FOTO = { img: null, w: 0, h: 0, crop: null, res: null, file: null, busy: false };
function fotoRender() {
  const box = $("bFotoBody"); if (!box) return; bpStatus();
  if (FOTO.img) {            // Bearbeiten
    const r = FOTO.res || {};
    box.innerHTML = `<p class="hint">Verschieben mit dem Finger, Grösse mit dem Regler. Der Kreis ist genau, was ins Schreiben kommt.</p>
      <div class="fotoedit"><canvas id="fCanvas" width="560" height="560"></canvas></div>
      <label class="f"><small>Grösse</small><input type="range" id="fZoom" min="0.2" max="1" step="0.005"></label>
      <div id="fCheck">${r.hinweise ? `${r.tauglich === false ? `<div class="tip warn">Claude: eher nicht geeignet.</div>` : ""}${(r.hinweise || []).map((h) => `<div class="tip">${esc(h)}</div>`).join("") || `<div class="tip ok">✦ Claude: Foto passt gut.</div>`}` : FOTO.busy ? `<p class="hint">✦ Claude prüft das Foto und sucht den besten Ausschnitt …</p>` : ""}</div>
      <label class="chk"><input type="checkbox" id="fStd"> Als Standard für alle Bewerbungen</label>
      <div class="kbar"><button type="button" class="btn sm" id="fCancel">Abbrechen</button><button type="button" class="btn sm" id="fAuto">✦ Ausschnitt von Claude</button><button type="button" class="btn primary" id="fSave">Foto übernehmen</button></div>`;
    $("fZoom").value = FOTO.crop.s / Math.min(FOTO.w, FOTO.h);
    fotoDraw(); fotoBind(); return;
  }
  const own = BEW.doc.foto?.path, std = BEW.ctx.vorlage?.foto;
  box.innerHTML = `<div class="fotorow"><img class="fotoprev" data-src="${esc(own || std || "dossier/vorlage/foto-standard-vorschau.png")}" alt="">
    <div><p class="hint">${own ? "Eigenes Foto für diese Wohnung." : std ? "Euer Standard-Foto." : "Standard: Familienfoto der Vorlage."}</p>
    <div class="kbar"><label class="btn sm" for="fFile">${own ? "Anderes Foto" : "Eigenes Foto wählen"}</label><input type="file" id="fFile" accept="image/*" hidden>
    ${own ? `<button type="button" class="btn sm" id="fEdit">Ausschnitt ändern</button><button type="button" class="linkbtn" id="fStdUse">Standard verwenden</button>` : ""}</div></div></div>`;
  box.querySelectorAll("img[data-src]").forEach(async (im) => { try { im.src = await repoFile(im.dataset.src); } catch { } });
}
function fotoDraw() {
  const c = $("fCanvas"); if (!c || !FOTO.img) return;
  const g = c.getContext("2d"), N = c.width, { x, y, s } = FOTO.crop;
  g.clearRect(0, 0, N, N);
  g.drawImage(FOTO.img, x, y, s, s, 0, 0, N, N);
  g.save(); g.fillStyle = "rgba(245,245,243,.82)"; g.beginPath(); g.rect(0, 0, N, N); g.arc(N / 2, N / 2, N / 2 - 2, 0, Math.PI * 2, true); g.fill("evenodd"); g.restore();
  g.strokeStyle = "rgba(0,104,170,.9)"; g.lineWidth = 3; g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 2, 0, Math.PI * 2); g.stroke();
}
function fotoClamp() {
  const c = FOTO.crop, m = Math.min(FOTO.w, FOTO.h);
  c.s = Math.max(m * 0.2, Math.min(m, c.s)); c.x = Math.max(0, Math.min(FOTO.w - c.s, c.x)); c.y = Math.max(0, Math.min(FOTO.h - c.s, c.y));
}
// Claude-Vorschlag übernehmen und absichern: Innenkreis muss alle Köpfe (mit Rand) enthalten
function fotoFromClaude(res) {
  const W = FOTO.w, H = FOTO.h, m = Math.min(W, H), a = res.ausschnitt || {};
  const heads = (res.koepfe || []).map((k) => ({ x0: k.x0 * W / 1000, x1: k.x1 * W / 1000, y0: k.y0 * H / 1000, y1: k.y1 * H / 1000 }));
  let cx = (a.mitte_x ?? 500) * W / 1000, cy = (a.mitte_y ?? 500) * H / 1000, s = (a.seite ?? 800) * m / 1000;
  for (let i = 0; i < 40 && heads.length; i++) {
    const r = s / 2;
    // Köpfe sind rund: Punkte auf der Ellipse im Kopf-Rahmen müssen im Kreis liegen (mit 5 % Rand)
    const out = heads.some((h) => [0, 1, 2, 3, 4, 5, 6, 7].some((i) => { const t = i * Math.PI / 4;
      const px = (h.x0 + h.x1) / 2 + Math.cos(t) * (h.x1 - h.x0) / 2, py = (h.y0 + h.y1) / 2 + Math.sin(t) * (h.y1 - h.y0) / 2;
      return Math.hypot(px - cx, py - cy) > r * 0.95; }));
    if (!out) break;
    const hx = (Math.min(...heads.map((h) => h.x0)) + Math.max(...heads.map((h) => h.x1))) / 2, hy = (Math.min(...heads.map((h) => h.y0)) + Math.max(...heads.map((h) => h.y1))) / 2;
    cx += (hx - cx) * 0.25; cy += (hy - cy) * 0.25; s = Math.min(m, s * 1.04);
  }
  FOTO.crop = { x: cx - s / 2, y: cy - s / 2, s }; fotoClamp();
}
function fotoBind() {
  const c = $("fCanvas"); let drag = null;
  c.onpointerdown = (e) => { drag = { px: e.clientX, py: e.clientY, x: FOTO.crop.x, y: FOTO.crop.y }; c.setPointerCapture(e.pointerId); };
  c.onpointermove = (e) => { if (!drag) return; const k = FOTO.crop.s / c.getBoundingClientRect().width;
    FOTO.crop.x = drag.x - (e.clientX - drag.px) * k; FOTO.crop.y = drag.y - (e.clientY - drag.py) * k; fotoClamp(); fotoDraw(); };
  c.onpointerup = c.onpointercancel = () => (drag = null);
  $("fZoom").oninput = (e) => { const c0 = FOTO.crop, mid = [c0.x + c0.s / 2, c0.y + c0.s / 2];
    c0.s = +e.target.value * Math.min(FOTO.w, FOTO.h); c0.x = mid[0] - c0.s / 2; c0.y = mid[1] - c0.s / 2; fotoClamp(); fotoDraw(); };
}
async function fotoOpen(file) {
  const blob = await shrinkImage(file);            // gleiche Pixel für Claude und Ausschnitt
  const bmp = await createImageBitmap(blob);
  Object.assign(FOTO, { img: bmp, w: bmp.width, h: bmp.height, file: blob, res: null });
  const m = Math.min(bmp.width, bmp.height); FOTO.crop = { x: (bmp.width - m * 0.8) / 2, y: (bmp.height - m * 0.8) / 2, s: m * 0.8 };
  fotoRender(); await fotoCheck();
}
async function fotoCheck() {
  if (!BEW.ctx.key) { FOTO.res = { hinweise: ["Kein Claude-Schlüssel – Ausschnitt bitte von Hand wählen."] }; fotoRender(); return; }
  FOTO.busy = true; FOTO.res = null; fotoRender();
  try {
    const res = await claudeTool("Du prüfst Fotos für Wohnungsbewerbungen. Antworte nur über das Werkzeug «foto».",
      [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobB64(FOTO.file) } }, { type: "text", text: FOTO_PROMPT }], FOTO_TOOL, "ausschnitt");
    FOTO.res = res; fotoFromClaude(res);
    const n = (res.hinweise || []).length;
    toast(res.tauglich === false ? "Claude: eher nicht geeignet" : n ? `Geprüft – ${n} Hinweis${n > 1 ? "e" : ""}` : "Foto passt gut", res.tauglich === false ? "err" : "ok");
  } catch (e) { FOTO.res = { hinweise: ["Claude konnte das Foto nicht prüfen: " + e.message] }; toast("Claude: " + e.message, "err"); }
  finally { FOTO.busy = false; fotoRender(); }
}
async function fotoPng() {
  const N = 900, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
  g.beginPath(); g.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2); g.clip();
  const { x, y, s } = FOTO.crop; g.drawImage(FOTO.img, x, y, s, s, 0, 0, N, N);
  return await new Promise((r) => c.toBlob(r, "image/png"));
}
async function putFile(path, blob, message) {
  let sha; try { sha = (await gh(path)).sha; } catch { }
  await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, content: await blobB64(blob), branch: "main", ...(sha ? { sha } : {}) }) });
  fileCache.delete(path);
}
async function fotoSave() {
  if (needPerson()) return;
  const png = await fotoPng(), std = $("fStd")?.checked;
  const path = bewPath("foto.png"), orig = bewPath("foto-original.jpg");
  await putFile(path, png, `Bewerbungsfoto: ${BEW.x.street || BEW.k}`);
  await putFile(orig, FOTO.file, "Bewerbungsfoto (Original)");
  BEW.doc.foto = { path, orig, crop: { ...FOTO.crop, w: FOTO.w, h: FOTO.h }, hinweise: FOTO.res?.hinweise || [], by: S.person, at: new Date().toISOString() };
  if (std) {
    await putFile("dossier/vorlage/foto-standard.png", png, "Standard-Bewerbungsfoto");
    try { const r = await readJson("dossier/vorlage/anschreiben.json"); r.data.foto = "dossier/vorlage/foto-standard.png";
      await writeJson("dossier/vorlage/anschreiben.json", r.data, r.sha, "Standard-Bewerbungsfoto"); BEW.ctx.vorlage = r.data; } catch (e) { toast("Standard nicht gespeichert: " + e.message, "err"); }
  }
  await bewSave(true);
  FOTO.img = null; fotoRender();
  toast(std ? "Foto übernommen – auch als Standard." : "Foto übernommen. Es kommt ins nächste PDF.", "ok");
}
$("bBody").addEventListener("change", async (e) => {
  if (e.target.id !== "fFile" || !e.target.files[0]) return;
  try { await fotoOpen(e.target.files[0]); } catch (er) { toast("Foto nicht lesbar: " + er.message, "err"); }
});
$("bBody").addEventListener("click", async (e) => {
  const id = e.target.id;
  if (id === "fCancel") { FOTO.img = null; fotoRender(); }
  if (id === "fAuto" && FOTO.res?.ausschnitt) { fotoFromClaude(FOTO.res); fotoRender(); }
  if (id === "fSave") { e.target.disabled = true; try { await fotoSave(); } catch (er) { toast("Nicht gespeichert: " + er.message, "err"); } finally { if (e.target.isConnected) e.target.disabled = false; } }
  if (id === "fStdUse") { delete BEW.doc.foto; await bewSave(true); fotoRender(); toast("Standard-Foto wird verwendet.", "ok"); }
  if (id === "fEdit" && BEW.doc.foto?.orig) {
    try { const b = await (await fetch(await repoFile(BEW.doc.foto.orig))).blob(); const bmp = await createImageBitmap(b);
      Object.assign(FOTO, { img: bmp, w: bmp.width, h: bmp.height, file: b, res: { hinweise: BEW.doc.foto.hinweise || [] } });
      const c = BEW.doc.foto.crop || {}; FOTO.crop = { x: c.x || 0, y: c.y || 0, s: c.s || Math.min(bmp.width, bmp.height) }; fotoClamp(); fotoRender(); }
    catch (er) { toast("Original nicht ladbar: " + er.message, "err"); }
  }
});
// --- PDF-Grundlagen: Vorlage, Schriften, Unterschriften (einmal laden) ---
async function pdfAssets() {
  if (BEW.assets) return BEW.assets;
  await pdfLibs();
  const files = ["dossier/vorlage/canva-ohne-text.pdf", "dossier/schriften/OldStandard-Regular.ttf", "dossier/schriften/OldStandard-Italic.ttf",
    "dossier/schriften/OldStandard-Bold.ttf", "dossier/unterschriften/pascal.png", "dossier/unterschriften/leonie.png"];
  const [tpl, fR, fI, fB, sigP, sigL] = await Promise.all(files.map(repoBytes));
  BEW.assets = { tpl, fR, fI, fB, sigP, sigL };
  return BEW.assets;
}
async function vorlagePage() {
  const A = await pdfAssets(), { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.load(A.tpl); pdf.registerFontkit(window.fontkit);
  const F = { R: await pdf.embedFont(A.fR, { subset: true }), I: await pdf.embedFont(A.fI, { subset: true }), B: await pdf.embedFont(A.fB, { subset: true }) };
  return { pdf, pg: pdf.getPage(0), F };
}
const pcol = (c) => window.PDFLib.rgb(c[0], c[1], c[2]);
function kontaktBlock(pg, F) {
  const { rgb, LineCapStyle } = window.PDFLib;
  pg.drawRectangle({ x: 355, y: 41.8, width: 175, height: 51, color: pcol(LAY.blob) });
  const k = BEW.ctx.vorlage.kontakt || {};
  [[ICON_MAIL, k.email], ...(k.tel || []).map((t) => [ICON_TEL, t])].slice(0, 3).forEach(([ic, txt], j) => {
    const base = LAY.base - (LAY.kontaktTop + j * LAY.lead);
    ic.forEach((p) => pg.drawSvgPath(p, { x: LAY.iconX, y: base - 1.3 + 11, scale: 11 / 24, borderColor: rgb(1, 1, 1), borderWidth: 1.9, borderLineCap: LineCapStyle.Round }));
    pg.drawText(txt || "", { x: LAY.textX, y: base, size: LAY.size, font: F.R, color: rgb(1, 1, 1) });
  });
}
async function anschreibenBytes(ask = true) {
  const { pdf, pg, F } = await vorlagePage();
  const { lines, warn } = layoutPdf(BEW.doc, F);
  if (ask && warn.length && !confirm(warn.join("\n") + "\n\nTrotzdem erstellen?")) return null;
  let adrSize = LAY.adrSize; while (F.R.widthOfTextAtSize(BEW.doc.adresse, adrSize) > 595.5 - LAY.adrX - 16 && adrSize > 10) adrSize -= 0.5;
  pg.drawText(BEW.doc.adresse, { x: LAY.adrX, y: LAY.adrY, size: adrSize, font: F.R, color: pcol(LAY.ink) });
  for (const l of lines) {
    let x = LAY.x0;
    for (const s of l.segs) { pg.drawText(s.t, { x, y: LAY.base - l.top, size: LAY.size, font: s.mark ? F.I : F.R, color: pcol(s.mark ? LAY.mark : LAY.ink) }); x += s.w; }
  }
  kontaktBlock(pg, F);
  const fotoPath = BEW.doc.foto?.path || BEW.ctx.vorlage?.foto;
  if (fotoPath) {             // eigenes Kreisfoto genau über das Foto der Vorlage (Mitte 136.9/702.7, r 110.9 + Rand)
    try { const img = await pdf.embedPng(await repoBytes(fotoPath)); const r = FOTO_R;
      pg.drawImage(img, { x: FOTO_CX - r, y: FOTO_CY - r, width: 2 * r, height: 2 * r }); }
    catch (e) { console.warn("Foto", e); }
  }
  pdf.setTitle("Wohnungsbewerbung " + BEW.doc.adresse); pdf.setAuthor("Leonie Meier, Pascal Stadelmann");
  return pdf.save();
}

// --- Personalien-Seite im Stil der Vorlage (Foto und Titel der Vorlage überdeckt) ---
const dmyL = (iso) => { if (!iso) return ""; const m = String(iso).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); if (!m) return String(iso);
  return m[3] ? `${+m[3]}.${+m[2]}.${m[1]}` : new Date(+m[1], +m[2] - 1, 1).toLocaleDateString("de-CH", { month: "long", year: "numeric" }); };
// Zeile 1: Beruf, Arbeitgeber, seit · Zeile 2: Pensum, befristet bis
const jobLine = (j) => [[j.titel, j.arbeitgeber, j.seit ? "seit " + dmyL(j.seit) : ""].filter(Boolean).join(", "),
  [j.pensum, j.bis ? "befristet bis " + dmyL(j.bis) : ""].filter(Boolean).join(", ")].filter(Boolean).join("\n");
async function personalienBytes() {
  const { pdf, pg, F } = await vorlagePage(), A = BEW.assets, st = BEW.ctx.stamm;
  const BG = [0.9373, 0.9216, 0.8941], ink = pcol(LAY.ink), acc = pcol(LAY.mark), hair = pcol([0.80, 0.78, 0.74]);
  pg.drawRectangle({ x: 14, y: 570, width: 250, height: 260, color: pcol(BG) });     // Foto
  pg.drawRectangle({ x: 262, y: 676, width: 320, height: 60, color: pcol(BG) });     // «Wohnungsbewerbung»
  const P = st.personen || [], X = [26, 160, 365], CW = [128, 195, 192];
  const wrap1 = (txt, font, size, w) => { const out = []; let cur = "";
    for (const wd of String(txt || "").split(/[ \t]+/).filter(Boolean)) { const t = cur ? cur + " " + wd : wd; if (font.widthOfTextAtSize(t, size) <= w || !cur) cur = t; else { out.push(cur); cur = wd; } }
    if (cur) out.push(cur); return out.length ? out : [""]; };
  const wrap = (txt, font, size, w) => String(txt || "").split("\n").flatMap((l) => wrap1(l, font, size, w));
  let y = 772;
  pg.drawText("Personalien", { x: 26, y, size: 30.6, font: F.R, color: ink });
  y -= 24; pg.drawText(BEW.doc.adresse ? "Bewerbung " + BEW.doc.adresse : "", { x: 27, y, size: 13, font: F.R, color: ink });
  y -= 36;
  P.forEach((p, i) => pg.drawText(`${p.vorname} ${p.nachname}`, { x: X[i + 1], y, size: 12.5, font: F.B, color: ink }));
  y -= 8;
  const S10 = 10.5, LD = 13.5;
  const row = (label, vals) => {
    const cols = vals.map((v, i) => wrap(v, F.R, S10, CW[i + 1]));
    const n = Math.max(1, ...cols.map((c) => c.length));
    pg.drawLine({ start: { x: 26, y: y + 2 }, end: { x: 557, y: y + 2 }, thickness: 0.5, color: hair });
    y -= LD;
    pg.drawText(label, { x: X[0], y, size: S10, font: F.R, color: acc });
    cols.forEach((c, i) => c.forEach((l, k) => pg.drawText(l, { x: X[i + 1], y: y - k * LD, size: S10, font: F.R, color: ink })));
    y -= (n - 1) * LD + 5;
  };
  const per = (f) => P.map(f);
  row("Geburtsdatum", per((p) => dmyL(p.geburtsdatum)));
  row("Zivilstand", per((p) => p.zivilstand ? p.zivilstand[0].toUpperCase() + p.zivilstand.slice(1) : ""));
  row("Heimatort", per((p) => [p.heimatort, p.nationalitaet].filter(Boolean).join(", ")));
  row("Telefon", per((p) => p.telefon || ""));
  row("E-Mail", per((p) => p.email || ""));
  row("Beruf", per((p) => (p.jobs || []).map(jobLine).join("\n\n")));
  row("Einkommen brutto", per((p) => p.einkommen || ""));
  pg.drawLine({ start: { x: 26, y: y + 2 }, end: { x: 557, y: y + 2 }, thickness: 0.5, color: hair });
  // Abschnitte; unten rechts liegt die blaue Fläche → dort schmaler setzen
  const maxX = (yy) => (yy < 190 ? 290 : 557);
  const section = (title) => { y -= 24; pg.drawText(title, { x: 26, y, size: 12, font: F.B, color: acc }); y -= 4; };
  const para = (txt, font = F.R, size = S10) => wrap(txt, font, size, maxX(y - LD) - 26).forEach((l) => { y -= LD; pg.drawText(l, { x: 26, y, size, font, color: ink }); });
  const h = st.haushalt || {}, w = st.wohnen || {}, yn = (v) => (v ? "ja" : "nein");
  section("Haushalt");
  para([...(st.kinder || []).map((k) => `Kind: ${k.vorname} (geboren ${dmyL(k.geburt)})`)].join(" · "));
  para(`Haustiere: ${h.haustiere ? "ja" : "keine"} · Rauchen: ${yn(h.raucher)} · Musikinstrumente: ${yn(h.musikinstrumente)}${h.fahrzeug ? " · Fahrzeug: " + h.fahrzeug : ""}`);
  section("Heutige Wohnung");
  para([w.adresse, w.seit ? "seit " + dmyL(w.seit) : "", w.miete_brutto ? "Mietzins CHF " + Number(w.miete_brutto).toLocaleString("de-CH") + " brutto" : "", w.vermieter ? "Verwaltung: " + w.vermieter : ""].filter(Boolean).join(", "));
  section("Referenzen");
  (st.referenzen || []).forEach((r) => {
    y -= 3; para(r.rolle || "", F.B, S10);
    para([[r.name, r.firma].filter(Boolean).join(", "), r.telefon, r.email].filter(Boolean).join(" · "));
  });
  // Ort, Datum, Unterschriften (links unten, neben der blauen Fläche)
  const sy = Math.min(y - 30, 128);
  pg.drawText("Zürich, " + new Date().toLocaleDateString("de-CH"), { x: 26, y: sy, size: S10, font: F.R, color: ink });
  const imgP = await pdf.embedPng(A.sigP), imgL = await pdf.embedPng(A.sigL), sw = 105, sh = sw * 560 / 1500;
  pg.drawImage(imgP, { x: 22, y: sy - 12 - sh, width: sw, height: sh });
  pg.drawImage(imgL, { x: 148, y: sy - 12 - sh, width: sw, height: sh });
  pg.drawText(P[0] ? `${P[0].vorname} ${P[0].nachname}` : "", { x: 26, y: sy - 22 - sh, size: 9, font: F.R, color: ink });
  pg.drawText(P[1] ? `${P[1].vorname} ${P[1].nachname}` : "", { x: 152, y: sy - 22 - sh, size: 9, font: F.R, color: ink });
  kontaktBlock(pg, F);
  pdf.setTitle("Personalien " + P.map((p) => p.vorname + " " + p.nachname).join(", "));
  return pdf.save();
}

// --- Dossier: Auswahl, Einzel-Downloads, Gesamt-PDF ---
const fileSlug = (s) => String(s || "").replace(/[«»"]/g, "").replace(/[^\wäöüÄÖÜ]+/g, "_").replace(/^_|_$/g, "");
function baustAlter(b) {
  if (!b.datum || !b.gueltig_monate) return null;
  const d = new Date(b.datum), bis = new Date(d.getFullYear(), d.getMonth() + b.gueltig_monate, d.getDate());
  const tage = Math.round((bis - new Date()) / 864e5);
  return { bis, tage, alt: tage < 0, bald: tage >= 0 && tage <= 14 };
}
// Reihenfolge: Bausteine wie in bausteine.json (gilt für alle); Beilagen einer Wohnung hängen hinter `nach` (Standard: Personalien)
function dossierItems() {
  const bs = (BEW.ctx.bausteine || []).filter((b) => b.id !== "formular");
  const beil = (BEW.doc.beilagen || []).map((b) => ({ ...b, beilage: true }));
  const out = beil.filter((b) => b.nach === "_start");
  for (const b of bs) {
    out.push(b);
    out.push(...beil.filter((x) => (x.nach || "personalien") === b.id));
  }
  out.push(...beil.filter((x) => x.nach !== "_start" && !bs.some((b) => b.id === (x.nach || "personalien"))));
  return out;
}
function reorderBy(list, order) {
  const pos = new Map(order.map((id, i) => [id, i]));
  const sorted = list.filter((b) => pos.has(b.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
  let k = 0; return list.map((b) => (pos.has(b.id) ? sorted[k++] : b));
}
const mvBtns = (attr, id, first, last) => `<span class="mv"><button type="button" ${attr}="${esc(id)}" data-dir="-1" aria-label="Nach oben"${first ? " disabled" : ""}>↑</button><button type="button" ${attr}="${esc(id)}" data-dir="1" aria-label="Nach unten"${last ? " disabled" : ""}>↓</button></span>`;
let orderTimer = null;
function dossierMove(id, dir) {
  const items = dossierItems(), i = items.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  let prev = "_start"; const beil = [];
  for (const it of items) { if (it.beilage) { const b = { ...BEW.doc.beilagen.find((x) => x.id === it.id), nach: prev }; beil.push(b); } else prev = it.id; }
  const beilChanged = JSON.stringify(beil) !== JSON.stringify(BEW.doc.beilagen || []);
  if (beil.length) BEW.doc.beilagen = beil;
  const order = items.filter((x) => !x.beilage).map((x) => x.id);
  const before = BEW.ctx.bausteine.filter((b) => b.id !== "formular").map((b) => b.id).join();
  BEW.ctx.bausteine = reorderBy(BEW.ctx.bausteine, order);
  renderDossier();
  document.querySelector(`#bDossierList [data-mv="${CSS.escape(id)}"][data-dir="${dir}"]`)?.focus();
  if (beilChanged) bewMark();
  if (order.join() !== before) {
    clearTimeout(orderTimer);
    orderTimer = setTimeout(() => baustWrite((L) => { const r = reorderBy(L, order); L.splice(0, L.length, ...r); }, "Dossier-Reihenfolge geändert")
      .then(() => toast("Reihenfolge gespeichert – gilt für alle Bewerbungen.", "ok")).catch((e) => toast("Reihenfolge nicht gespeichert: " + e.message, "err")), 1200);
  }
}
const dossierOn = (b) => (BEW.doc.auswahl && b.id in BEW.doc.auswahl ? BEW.doc.auswahl[b.id] : b.beilage ? true : !!b.standard);
function renderDossier() {
  const el = $("bDossierList"); if (!el) return;
  const all = dossierItems();
  el.innerHTML = all.map((b, idx) => {
    const a = baustAlter(b);
    const chip = !a ? (b.datum ? `<small>${esc(dmyL(b.datum))}</small>` : "") : a.alt ? `<small class="old">zu alt seit ${esc(a.bis.toLocaleDateString("de-CH"))}</small>`
      : a.bald ? `<small class="soon">gültig bis ${esc(a.bis.toLocaleDateString("de-CH"))}</small>` : `<small>gültig bis ${esc(a.bis.toLocaleDateString("de-CH"))}</small>`;
    return `<div class="drow"><label><input type="checkbox" data-dsel="${esc(b.id)}"${dossierOn(b) ? " checked" : ""}><span>${esc(b.titel)}${chip}</span></label>
      ${mvBtns("data-mv", b.id, idx === 0, idx === all.length - 1)}<button type="button" class="iconbtn" data-dl="${esc(b.id)}" aria-label="${esc(b.titel)} herunterladen">⬇</button>${b.beilage ? `<button type="button" class="iconbtn" data-bdel="${esc(b.id)}" aria-label="Entfernen">✕</button>` : ""}</div>`;
  }).join("");
}
async function itemBytes(b) {
  if (b.id === "anschreiben") return { bytes: await anschreibenBytes(false), type: "application/pdf" };
  if (b.id === "personalien") return { bytes: await personalienBytes(), type: "application/pdf" };
  const path = b.beilage ? b.datei : "dossier/" + b.datei;
  const bytes = await repoBytes(path);
  return { bytes, type: /\.pdf$/i.test(path) ? "application/pdf" : /\.png$/i.test(path) ? "image/png" : "image/jpeg" };
}
const itemName = (b, type) => {
  const st = fileSlug(BEW.x.street || "Wohnung");
  const base = b.id === "anschreiben" ? `Anschreiben_${st}` : b.id === "personalien" ? "Personalien_Meier_Stadelmann" : fileSlug(b.titel);
  return base + (type === "application/pdf" ? ".pdf" : type === "image/png" ? ".png" : ".jpg");
};
function saveBlob(bytes, type, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function dossierDownload(id) {
  const b = dossierItems().find((x) => x.id === id); if (!b) return;
  toast(`Bereite «${b.titel}» vor …`, "", 0);
  try { await pdfAssets(); const { bytes, type } = await itemBytes(b); saveBlob(bytes, type, itemName(b, type)); toast("Heruntergeladen.", "ok"); }
  catch (e) { toast("Nicht ladbar: " + e.message, "err"); }
}
async function dossierBytes() {
  const { PDFDocument } = window.PDFLib, out = await PDFDocument.create();
  for (const b of dossierItems().filter(dossierOn)) {
    const { bytes, type } = await itemBytes(b);
    if (type === "application/pdf") {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
    } else {
      const img = type === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      const pg = out.addPage([595.28, 841.89]), s = Math.min(555 / img.width, 800 / img.height, 1);
      pg.drawImage(img, { x: (595.28 - img.width * s) / 2, y: (841.89 - img.height * s) / 2, width: img.width * s, height: img.height * s });
    }
  }
  out.setTitle("Bewerbungsdossier " + BEW.doc.adresse); out.setAuthor("Leonie Meier, Pascal Stadelmann");
  return out.save();
}
async function dossierPdf(btn = $("bDossierPdf"), linkBox = $("bDossierLink")) {
  bewRead();
  const sel = dossierItems().filter(dossierOn);
  if (!sel.length) { toast("Nichts ausgewählt.", "err"); return; }
  const alt = sel.filter((b) => baustAlter(b)?.alt).map((b) => b.titel);
  if (alt.length && !confirm(`Zu alt: ${alt.join(", ")}\n\nTrotzdem ins Dossier nehmen?`)) return;
  const offen = (BEW.doc.text + " " + BEW.doc.name).match(/\[[^\]]*\]/g);
  if (sel.some((b) => b.id === "anschreiben") && offen && !confirm(`Im Anschreiben noch offen: ${offen.join(", ")}\n\nTrotzdem erstellen?`)) return;
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Erstelle Dossier …";
  if (sel.some((b) => b.id === "anschreiben")) bewPdfStore().catch(() => { });
  try {
    await pdfAssets();
    const bytes = await dossierBytes();
    const name = `Bewerbungsdossier_${fileSlug(BEW.x.street || "Wohnung")}.pdf`;
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const mb = (bytes.length / 1048576).toFixed(1);
    linkBox.innerHTML = `<a class="doclink" href="${url}" target="_blank" rel="noopener">📄 Dossier öffnen</a> <a class="doclink" href="${url}" download="${esc(name)}">⬇ Herunterladen</a>
      <p class="hint">${sel.length} Teile, ${mb} MB${mb > 9 ? " – für manche Mail-Postfächer zu gross, dann einzeln senden" : ""}.</p>`;
    toast("Dossier erstellt.", "ok");
  } catch (e) { toast("Dossier fehlgeschlagen: " + e.message, "err"); }
  finally { btn.disabled = false; btn.textContent = label; }
}
async function beilageUpload(files) {
  const added = [];
  for (const [i, f] of [...files].entries()) {
    if (f.size > 12e6) { toast(`«${f.name}» ist zu gross (max. 12 MB).`, "err"); continue; }
    const pdf = f.type === "application/pdf", blob = pdf ? f : await shrinkImage(f);
    const id = "beilage-" + Date.now().toString(36) + i, path = bewPath(`beilagen/${id}.${pdf ? "pdf" : "jpg"}`);
    try {
      await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Bewerbung Beilage: ${BEW.x.street || BEW.k}`, content: await blobB64(blob), branch: "main" }) });
      added.push({ id, titel: f.name.replace(/\.[^.]+$/, "") || "Dokument", datei: path });
    } catch (e) { toast("Hochladen fehlgeschlagen: " + e.message, "err"); }
  }
  if (added.length) {
    BEW.doc.beilagen = [...(BEW.doc.beilagen || []), ...added];
    renderDossier(); bewMark();
    toast(`${added.length} Dokument${added.length > 1 ? "e" : ""} hinzugefügt – Speichern nicht vergessen.`, "ok");
  }
}

// --- Personalien & Referenzen bearbeiten (gilt für alle Bewerbungen) ---
const spGet = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function spSet(o, p, v) { const ks = p.split("."); let a = o; ks.slice(0, -1).forEach((k, i) => { if (a[k] == null) a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; }); a[ks.at(-1)] = v; }
function stammForm() {
  const st = BEW.ctx.stamm;
  // Kompakt: eine Spalte, Label links, Wert rechts; Text bricht um (Textfeld wächst mit)
  const inp = (p, label, type = "text") => `<label class="sf"><span>${esc(label)}</span>${type === "date"
    ? `<input class="sfin" data-sp="${p}" type="date" value="${esc(spGet(st, p) ?? "")}">`
    : `<textarea class="sfin" data-sp="${p}" rows="1"${type === "number" ? ' inputmode="numeric" data-num' : ""}>${esc(spGet(st, p) ?? "")}</textarea>`}</label>`;
  const yn = (p, label) => `<label class="sf"><span>${esc(label)}</span><select class="sfin" data-sp="${p}" data-bool>${["nein", "ja"].map((o, i) => `<option value="${i}"${!!spGet(st, p) === !!i ? " selected" : ""}>${o}</option>`).join("")}</select></label>`;
  const pers = (st.personen || []).map((p, i) => `<div class="sfhead">${esc(p.vorname)} ${esc(p.nachname)}</div>
    ${inp(`personen.${i}.telefon`, "Telefon")}${inp(`personen.${i}.email`, "E-Mail")}
    ${inp(`personen.${i}.zivilstand`, "Zivilstand")}${inp(`personen.${i}.einkommen`, "Einkommen (Personalien)")}
    ${inp(`personen.${i}.steuer.jahr`, "Steuerjahr")}${inp(`personen.${i}.steuer.nettoeinkommen`, "Nettoeinkommen (Steuer)")}${inp(`personen.${i}.steuer.reinvermoegen`, "Reinvermögen (Steuer)")}
    ${(p.jobs || []).map((j, k) => `<div class="sfbox"><div class="sfsub">Stelle ${k + 1}</div>
      ${inp(`personen.${i}.jobs.${k}.titel`, "Beruf")}${inp(`personen.${i}.jobs.${k}.arbeitgeber`, "Arbeitgeber")}
      ${inp(`personen.${i}.jobs.${k}.pensum`, "Pensum")}${inp(`personen.${i}.jobs.${k}.brutto_pa`, "Einkommen (Formulare)")}
      ${inp(`personen.${i}.jobs.${k}.adresse`, "Adresse Arbeitgeber")}${inp(`personen.${i}.jobs.${k}.seit`, "seit", "date")}${inp(`personen.${i}.jobs.${k}.bis`, "befristet bis", "date")}
      <button type="button" class="linkbtn" data-spdel="personen.${i}.jobs.${k}">Stelle entfernen</button></div>`).join("")}
    <button type="button" class="linkbtn" data-spadd="personen.${i}.jobs">+ Stelle hinzufügen</button>`).join("");
  const refs = (st.referenzen || []).map((r, k) => `<div class="sfbox">
    ${inp(`referenzen.${k}.rolle`, "Rolle")}${inp(`referenzen.${k}.name`, "Name")}${inp(`referenzen.${k}.firma`, "Firma")}
    ${inp(`referenzen.${k}.telefon`, "Telefon")}${inp(`referenzen.${k}.email`, "E-Mail")}
    <button type="button" class="linkbtn" data-spdel="referenzen.${k}">Referenz entfernen</button></div>`).join("");
  return `${pers}
    <div class="sfhead">Haushalt</div>
    ${yn("haushalt.haustiere", "Haustiere")}${yn("haushalt.raucher", "Rauchen")}${yn("haushalt.musikinstrumente", "Musikinstrumente")}${inp("haushalt.fahrzeug", "Fahrzeug")}
    <div class="sfhead">Heutige Wohnung</div>
    ${inp("wohnen.adresse", "Adresse")}${inp("wohnen.seit", "seit", "date")}${inp("wohnen.miete_brutto", "Mietzins brutto (CHF)", "number")}${inp("wohnen.vermieter", "Verwaltung")}
    <div class="sfhead">Referenzen</div><p class="hint">Zusätze wie «Teamleader» einfach ins Feld schreiben.</p>${refs}
    <button type="button" class="linkbtn" data-spadd="referenzen">+ Referenz hinzufügen</button>
    <div class="brow"><button type="button" class="btn primary" id="spSave">Personalien speichern</button></div>`;
}
function sfFit(el) { if (el.tagName !== "TEXTAREA") return; el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
const sfFitAll = () => document.querySelectorAll("#bStamm textarea.sfin").forEach(sfFit);
function stammCollect() {
  document.querySelectorAll("#bStamm [data-sp]").forEach((el) => {
    let v = el.value; if (el.hasAttribute("data-bool")) v = v === "1";
    else if (el.hasAttribute("data-num")) { const t = v.replace(/[^\d.]/g, ""); v = t === "" ? null : Number(t); }
    else v = v.replace(/\s*\n\s*/g, " ").trim() || null;
    spSet(BEW.ctx.stamm, el.dataset.sp, v);
  });
}
function renderStamm() { if ($("bStammBody")) { $("bStammBody").innerHTML = stammForm(); requestAnimationFrame(sfFitAll); } }
async function stammSave() {
  const b = $("spSave"); if (b.disabled) return;
  stammCollect();
  b.disabled = true; b.textContent = "Speichere …";
  try {
    const r = await readJson("dossier/stammdaten.json");
    await writeJson("dossier/stammdaten.json", BEW.ctx.stamm, r.sha, `Personalien geändert (${PEOPLE[S.person] || ""})`);
    b.textContent = "Gespeichert ✓";
    toast("Personalien gespeichert – gelten für alle Bewerbungen.", "ok");
  } catch (e) { b.textContent = "Personalien speichern"; toast("Speichern fehlgeschlagen: " + e.message, "err"); }
  finally { b.disabled = false; setTimeout(() => { if ($("spSave")?.textContent === "Gespeichert ✓") $("spSave").textContent = "Personalien speichern"; }, 2500); }
}

// --- Optionen: Dossier-Bausteine verwalten ---
async function baustLoad() { const r = await readJson("dossier/bausteine.json"); S.baustSha = r.sha; return r.data; }
async function baustRender() {
  if (!$("baustList")) return;
  try {
    const d = await baustLoad(); S.baust = d;
    const vis = d.bausteine.filter((b) => b.datei);
    $("baustList").innerHTML = vis.map((b, idx) => {
      const a = baustAlter(b);
      return `<div class="drow"><label><input type="checkbox" data-bstd="${esc(b.id)}"${b.standard ? " checked" : ""}><span>${esc(b.titel)}
        <small class="${a?.alt ? "old" : a?.bald ? "soon" : ""}">${b.datum ? esc(dmyL(b.datum)) : "ohne Datum"}${a ? (a.alt ? " · zu alt" : " · gültig bis " + esc(a.bis.toLocaleDateString("de-CH"))) : ""}</small></span></label>
        ${mvBtns("data-bmv", b.id, idx === 0, idx === vis.length - 1)}<details class="dmenu"><summary aria-label="Aktionen für ${esc(b.titel)}">⋯</summary><div class="dmenu-list">
        <button type="button" data-bview="${esc(b.datei)}" data-bname="${esc(b.titel)}">Ansehen</button>
        <label>Ersetzen<input type="file" accept="application/pdf,image/*" data-brep="${esc(b.id)}" hidden></label>
        <button type="button" class="bad" data-bremove="${esc(b.id)}">Löschen</button></div></details></div>`;
    }).join("") + '<p class="hint">Häkchen = standardmässig im Dossier. ↑↓ = Reihenfolge im Dossier (Anschreiben und Personalien stehen vorne; im Bewerbungs-Editor lässt sich alles verschieben).</p>';
  } catch (e) { $("baustList").innerHTML = `<p class="hint">Nicht ladbar: ${esc(e.message)}</p>`; }
}
async function toPdfBytes(file) {
  if (file.type === "application/pdf") return new Uint8Array(await file.arrayBuffer());
  await pdfLibs();
  const { PDFDocument } = window.PDFLib, out = await PDFDocument.create();
  const blob = await shrinkImage(file), bytes = new Uint8Array(await blob.arrayBuffer());
  const img = blob.type === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
  const pg = out.addPage([595.28, 841.89]), s = Math.min(555 / img.width, 800 / img.height);
  pg.drawImage(img, { x: (595.28 - img.width * s) / 2, y: (841.89 - img.height * s) / 2, width: img.width * s, height: img.height * s });
  return out.save();
}
async function baustWrite(fn, msg) {
  const d = await baustLoad(); fn(d.bausteine);
  S.baustSha = await writeJson("dossier/bausteine.json", d, S.baustSha, msg);
  if (BEW.ctx) BEW.ctx.bausteine = d.bausteine;
  baustRender();
}
async function baustUpload(file, id, titel, datum, standard) {
  const bytes = await toPdfBytes(file);
  const fname = `bausteine/${fileSlug(id)}${datum ? "-" + datum : ""}-${Date.now().toString(36)}.pdf`;
  await gh("dossier/" + fname, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `Baustein: ${titel}`, content: await blobB64(new Blob([bytes], { type: "application/pdf" })), branch: "main" }) });
  return fname;
}
$("baustList").addEventListener("change", async (e) => {
  const std = e.target.closest("[data-bstd]");
  if (std) { try { await baustWrite((L) => { const b = L.find((x) => x.id === std.dataset.bstd); if (b) b.standard = std.checked; }, "Baustein Standard geändert"); toast("Gespeichert.", "ok"); } catch (er) { toast(er.message, "err"); } return; }
  const rep = e.target.closest("[data-brep]");
  if (rep && rep.files[0]) {
    const b = (S.baust?.bausteine || []).find((x) => x.id === rep.dataset.brep); if (!b) return;
    const datum = prompt("Ausstellungsdatum des neuen Dokuments (JJJJ-MM-TT):", new Date().toISOString().slice(0, 10)); if (datum === null) return;
    toast("Lade hoch …", "", 0);
    try { const f = await baustUpload(rep.files[0], b.id, b.titel, datum, b.standard);
      await baustWrite((L) => { const x = L.find((y) => y.id === b.id); x.datei = f; x.datum = datum || null; }, `Baustein ersetzt: ${b.titel}`); toast("Ersetzt.", "ok"); }
    catch (er) { toast("Ersetzen fehlgeschlagen: " + er.message, "err"); }
  }
});
$("baustList").addEventListener("click", async (e) => {
  const mv = e.target.closest("[data-bmv]");
  if (mv) {
    const vis = (S.baust?.bausteine || []).filter((b) => b.datei).map((b) => b.id), i = vis.indexOf(mv.dataset.bmv), j = i + +mv.dataset.dir;
    if (i < 0 || j < 0 || j >= vis.length) return;
    [vis[i], vis[j]] = [vis[j], vis[i]];
    try { await baustWrite((L) => { const r = reorderBy(L, vis); L.splice(0, L.length, ...r); }, "Dossier-Reihenfolge geändert"); toast("Reihenfolge gespeichert.", "ok"); }
    catch (er) { toast(er.message, "err"); }
    return;
  }
  const v = e.target.closest("[data-bview]");
  if (v) { openDoc("dossier/" + v.dataset.bview, v.dataset.bname || ""); return; }
  const del = e.target.closest("[data-bremove]");
  if (del && confirm("Diesen Baustein aus dem Dossier entfernen?")) {
    try { await baustWrite((L) => { const i = L.findIndex((x) => x.id === del.dataset.bremove); if (i >= 0) L.splice(i, 1); }, "Baustein entfernt"); toast("Entfernt.", "ok"); }
    catch (er) { toast(er.message, "err"); }
  }
});
$("baustAdd").addEventListener("click", async () => {
  const f = $("baustFile").files[0], titel = $("baustTitle").value.trim();
  if (!f || !titel) { toast("Titel und Datei angeben.", "err"); return; }
  const datum = $("baustDate").value || null, gueltig = $("baustValid").value ? Number($("baustValid").value) : null;
  $("baustAdd").disabled = true; toast("Lade hoch …", "", 0);
  try {
    const id = fileSlug(titel).toLowerCase() + "-" + Date.now().toString(36);
    const fname = await baustUpload(f, id, titel, datum, true);
    await baustWrite((L) => L.push({ id, titel, datei: fname, ...(datum ? { datum } : {}), ...(gueltig ? { gueltig_monate: gueltig } : {}), standard: $("baustStd").checked }), `Baustein hinzugefügt: ${titel}`);
    $("baustFile").value = ""; $("baustTitle").value = ""; $("baustDate").value = ""; toast("Baustein hinzugefügt.", "ok");
  } catch (er) { toast("Hinzufügen fehlgeschlagen: " + er.message, "err"); }
  finally { $("baustAdd").disabled = false; }
});

