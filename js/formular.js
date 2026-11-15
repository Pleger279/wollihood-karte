"use strict";
// ---------- Formular der Verwaltung (Schritt 4): Foto/Scan entzerren und ausfüllen, ausfüllbares PDF, Kopierliste ----------
const FW = 1240, FH = 1754, PT = 595.28 / FW, PH = 841.89;   // entzerrtes Formular: A4 mit 150 dpi; 1 px = PT pt
const FORM = { data: null, sha: null, canvas: null, view: null, sel: -1, state: "", sigs: null, scanDirty: false };
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
const formPath = (f) => bewPath("formular/" + f);
const INKC = [0.08, 0.16, 0.45];   // Schriftfarbe wie Kugelschreiber

const FORM_SYSTEM = `Du füllst Anmeldeformulare für Mietwohnungen aus, für Leonie Meier und Pascal Stadelmann (mit Sohn Lio).
- Pascal ist die erste Person (Mietinteressent), Leonie die zweite (Partnerin), sofern das Formular zwei Personen vorsieht.
- Werte nur aus den Stammdaten, der Bemerkung und dem Inserat. Nichts erfinden. Was fehlt, bleibt leer ("") und kommt als Hinweis.
- Schweizer Schreibweise, Datumsformat TT.MM.JJJJ, Beträge «CHF 96'382».
- Schweizer brauchen keinen Ausländerausweis: «–». Haustiere/Musikinstrumente gemäss Stammdaten («keine»).
- «Adresse / Telefon Arbeitgeber»: Adresse aus jobs[].adresse und Telefon aus den Referenzen. Hat eine Person zwei Stellen,
  die Hauptstelle zuerst und die zweite kurz mit Befristung (z.B. «Linienpilot; bis 31.12.2026 auch Schulsozialarbeiter»).
- Steuerwerte aus personen[].steuer (Nettoeinkommen, Reinvermögen). Fehlen sie, leer lassen und Hinweis geben.
- Konfession und ähnliche Angaben, die nicht in den Stammdaten stehen: leer lassen, Hinweis.
- Jeder Wert muss lesbar in seine Box passen (mindestens 7 pt Schrift): lieber kurze Formen wie «SWISS» statt
  «Swiss International Air Lines Ltd.», «Kanton Zürich» statt langer Behördennamen. Bei zu wenig Platz die Nebenstelle weglassen
  und das als Hinweis melden. Bei zweizeiligen Boxen Zeilenumbruch mit \n.
- Alter aus den Geburtsdaten und dem heutigen Datum berechnen (auch in der Bemerkung). Kleinkinder wie Leonie und Pascal es
  schreiben: «bald 2» bzw. in Monaten, nicht «1».
- Bemerkungen / Grund des Umzugs: kurze Fassung der mitgelieferten Bemerkung in der «wir»-Form, so lang, dass sie in die Zeilen passt
  (pro Zeile etwa so viele Zeichen, wie die Zeile breit ist, bei 9 pt Schrift). Grosseltern in Luzern als Grund behalten.
- Hinweise: was fehlt, was das Formular zusätzlich verlangt (Beilagen, Fristen, Adresse zum Einreichen).
- Antworte ausschliesslich mit dem Werkzeug.`;
const FORM_TOOL = { name: "formular", description: "Felder des Formulars mit Position und Wert",
  input_schema: { type: "object", required: ["ecken", "felder", "hinweise"], properties: {
    ecken: { type: "array", description: "Die 4 Ecken des Papierblatts in Pixeln dieses Bildes: oben links, oben rechts, unten rechts, unten links", items: { type: "array", items: { type: "number" } } },
    felder: { type: "array", items: { type: "object", required: ["label", "box", "wert"], properties: {
      label: { type: "string", description: "Beschriftung, bei zwei Personen mit Person, z.B. «Name (Pascal)»" },
      box: { type: "array", description: "[x0, y0, x1, y1] in Pixeln: die LEERE Fläche, in die geschrieben wird (nicht das Label)", items: { type: "number" } },
      wert: { type: "string" },
      typ: { type: "string", enum: ["text", "datum", "unterschrift"] },
      gruppe: { type: "string", description: "Für mehrzeilige Felder über mehrere Linien (z.B. Bemerkungen): gleicher Name für alle Zeilen, Wert nur in der ersten" } } } },
    hinweise: { type: "array", items: { type: "string" } } } } };
const ACRO_TOOL = { name: "formular", description: "Werte für die Felder eines ausfüllbaren PDF-Formulars",
  input_schema: { type: "object", required: ["felder", "hinweise"], properties: {
    felder: { type: "array", items: { type: "object", required: ["name", "wert"], properties: {
      name: { type: "string" }, label: { type: "string", description: "Verständliche Beschriftung" }, wert: { type: "string", description: "Bei Kontrollkästchen «ja» oder «nein»" },
      typ: { type: "string", enum: ["text", "check", "datum", "unterschrift"] } } } },
    hinweise: { type: "array", items: { type: "string" } } } } };

function formContext() {
  const doc = bewRead();
  return `Heute ist ${new Date().toLocaleDateString("de-CH")}.\n\n<stammdaten>\n${JSON.stringify(BEW.ctx.stamm, null, 1)}\n</stammdaten>\n\n<bemerkung>\n${doc.bemerkung || doc.text}\n</bemerkung>\n\n<inserat>\n${bewInserat()}\n</inserat>`;
}
function setFormState(t) { FORM.state = t; renderForm(); }

// --- Bilder laden, PDF-Seite rendern ---
async function fileCanvas(file, max) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); return c;
}
function scaleCanvas(src, max) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const c = document.createElement("canvas"); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c;
}
async function pdfPageCanvas(bytes) {
  if (!window.pdfjsLib) await loadScript(PDFJS + "pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
  const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise, page = await doc.getPage(1);
  const v0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 2400 / Math.max(v0.width, v0.height) });
  const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise; return c;
}
const canvasBytes = (c, q = 0.85) => new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), "image/jpeg", q));

// --- Entzerren (Homographie) und Scan-Look ---
function homography(P, Q) {   // H mit Q ≈ H·P für 4 Punktpaare
  const A = [], b = [];
  for (let i = 0; i < 4; i++) { const [x, y] = P[i], [u, v] = Q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j]; b[r] -= k * b[c]; }
  }
  return [...b.map((v, i) => v / A[i][i]), 1];
}
const hApply = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
const PAGE = [[0, 0], [FW, 0], [FW, FH], [0, FH]];
function warpPage(src, corners) {
  const H = homography(PAGE, corners), sw = src.width, sh = src.height;
  const S = src.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas"); out.width = FW; out.height = FH;
  const octx = out.getContext("2d"), O = octx.createImageData(FW, FH), D = O.data;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
    const w = H[6] * (x + .5) + H[7] * (y + .5) + H[8];
    const u = (H[0] * (x + .5) + H[1] * (y + .5) + H[2]) / w - .5, v = (H[3] * (x + .5) + H[4] * (y + .5) + H[5]) / w - .5;
    const i = (y * FW + x) * 4; D[i + 3] = 255;
    if (u < 0 || v < 0 || u >= sw - 1 || v >= sh - 1) { D[i] = D[i + 1] = D[i + 2] = 255; continue; }
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, j = (y0 * sw + x0) * 4, j2 = j + sw * 4;
    for (let c = 0; c < 3; c++) D[i + c] = (S[j + c] * (1 - fx) + S[j + 4 + c] * fx) * (1 - fy) + (S[j2 + c] * (1 - fx) + S[j2 + 4 + c] * fx) * fy;
  }
  octx.putImageData(O, 0, 0); return out;
}
function scanLook(cv) {   // wie ein Graustufen-Scan: Papierweiss pro Block schätzen, Schatten und Farbstich weg
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height, im = ctx.getImageData(0, 0, W, H), D = im.data, B = 32;
  const L = new Float32Array(W * H), gw = Math.ceil(W / B), gh = Math.ceil(H / B), g = new Float32Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x), l = D[i * 4] * .299 + D[i * 4 + 1] * .587 + D[i * 4 + 2] * .114, k = ((y / B) | 0) * gw + ((x / B) | 0);
    L[i] = l; if (l > g[k]) g[k] = l; }
  for (let pass = 0; pass < 2; pass++) { const t = g.slice(); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += t[yy * gw + xx]; n++; } } g[y * gw + x] = s / n; } }
  for (let y = 0; y < H; y++) { const gy = Math.min(gh - 1, Math.max(0, y / B - .5)), y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < W; x++) { const gx = Math.min(gw - 1, Math.max(0, x / B - .5)), x0 = Math.floor(gx), x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0;
      const bg = (g[y0 * gw + x0] * (1 - fx) + g[y0 * gw + x1] * fx) * (1 - fy) + (g[y1 * gw + x0] * (1 - fx) + g[y1 * gw + x1] * fx) * fy;
      let v = L[y * W + x] * 252 / Math.max(60, bg); v = v > 222 ? 255 : Math.max(0, v - 18);   // Weiss sauber, Schrift kräftiger
      const i = (y * W + x) * 4; D[i] = D[i + 1] = D[i + 2] = Math.min(255, v); } }
  ctx.putImageData(im, 0, 0);
}

// --- Ablauf: Foto/PDF → Claude → entzerren → prüfen ---
async function formStart(file) {
  if (!BEW.ctx.key) { toast("Zuerst den Claude-Schlüssel hinterlegen (Mehr).", "err"); return; }
  if (FORM.data && !confirm("Das bisherige Formular wird ersetzt. Weiter?")) return;
  setFormState("Bereite das Formular vor …");
  try {
    let src;
    if (file.type === "application/pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await pdfLibs();
      let fields = [];
      try { fields = (await window.PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true })).getForm().getFields(); } catch { }
      if (fields.length) return await formAcro(bytes, fields);
      src = await pdfPageCanvas(bytes.slice());
    } else src = await fileCanvas(file, 2400);
    const send = scaleCanvas(src, 1600), f = src.width / send.width;
    setFormState("Claude liest und füllt das Formular … (ca. 30–60 Sek.)");
    const b64 = send.toDataURL("image/jpeg", 0.88).split(",")[1];
    const res = await claudeTool(FORM_SYSTEM, [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
      { type: "text", text: `Das Bild ist ${send.width}×${send.height} Pixel. Finde die Blattecken und alle auszufüllenden Felder (auch «Ort, Datum» und Unterschrift) und fülle sie aus.\n\n${formContext()}` }], FORM_TOOL, "felder");
    let corners = (res.ecken || []).map(([x, y]) => [x * f, y * f]);
    if (corners.length !== 4) corners = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]];
    setFormState("Entzerre das Foto …");
    await new Promise((r) => setTimeout(r, 30));
    const rect = warpPage(src, corners); if (file.type !== "application/pdf") scanLook(rect);
    const Hs = homography(corners, PAGE);
    const felder = (res.felder || []).filter((x) => Array.isArray(x.box) && x.box.length === 4).map((x) => {
      const [x0, y0, x1, y1] = x.box.map((v) => v * f);
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([a, b]) => hApply(Hs, a, b));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return { label: x.label, wert: x.wert || "", typ: x.typ || "text", gruppe: x.gruppe || "", box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(Math.round) };
    });
    FORM.data = { typ: "scan", felder, hinweise: res.hinweise || [], quelle: file.name, at: new Date().toISOString(), by: S.person };
    FORM.canvas = rect; FORM.scanDirty = true; FORM.sel = -1; FORM.state = "";
    await formOriginal(file);
    renderForm();
    toast("Formular ausgefüllt – bitte prüfen und speichern.", "ok");
  } catch (e) { FORM.state = ""; renderForm(); toast("Formular fehlgeschlagen: " + e.message, "err"); }
}
async function formOriginal(file) {   // Original sichern (für später neu ausfüllen)
  try { await putRepoFile(formPath("original" + (file.type === "application/pdf" ? ".pdf" : ".jpg")),
    file.type === "application/pdf" ? file : await shrinkImage(file), `Formular Original: ${BEW.x.street || BEW.k}`); } catch { }
}
async function putRepoFile(path, blob, msg) {
  let sha; try { sha = (await gh(path)).sha; } catch { }
  await gh(path, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, content: await blobB64(blob), branch: "main", ...(sha ? { sha } : {}) }) });
  fileCache.delete(path);
}
async function formAcro(bytes, fields) {
  const { PDFCheckBox, PDFTextField } = window.PDFLib;
  const list = fields.map((fl) => ({ name: fl.getName(), typ: fl instanceof PDFCheckBox ? "check" : fl instanceof PDFTextField ? "text" : "andere" })).filter((x) => x.typ !== "andere");
  setFormState("Claude füllt das PDF-Formular … (ca. 20–40 Sek.)");
  const res = await claudeTool(FORM_SYSTEM, `Ausfüllbares PDF-Formular mit diesen Feldern (Name und Typ):\n${list.map((x) => `- ${x.name} (${x.typ})`).join("\n")}\n\nFülle alle Felder, die du aus den Daten kennst. Unterschriftsfelder mit typ «unterschrift».\n\n${formContext()}`, ACRO_TOOL, "felder");
  FORM.data = { typ: "acro", felder: (res.felder || []).filter((x) => list.some((l) => l.name === x.name)).map((x) => ({ name: x.name, label: x.label || x.name, wert: x.wert || "", typ: x.typ || list.find((l) => l.name === x.name).typ })),
    hinweise: res.hinweise || [], at: new Date().toISOString(), by: S.person };
  FORM.pdf = bytes; FORM.canvas = null; FORM.state = "";
  await putRepoFile(formPath("original.pdf"), new Blob([bytes], { type: "application/pdf" }), `Formular Original: ${BEW.x.street || BEW.k}`).catch(() => { });
  renderForm();
}

// --- Layout: Text in Feldboxen (in pt, y von oben) ---
const pdfSafe = (s) => String(s || "").replace(/[→←]/g, "-").replace(/[^\x20-\x7E -ÿ–—‘’“”…€]/g, "");
function formOps(measure) {
  const ops = [], F = FORM.data.felder, seen = new Set();
  const rect = (f) => { const [x0, y0, x1, y1] = f.box; return { x: x0 * PT + (f.dx || 0), y: y0 * PT + (f.dy || 0), w: (x1 - x0) * PT, h: (y1 - y0) * PT }; };
  const wrap = (txt, size, w) => { const out = []; for (const para of String(txt || "").split("\n").map(pdfSafe)) { let cur = "";
    for (const wd of para.split(/\s+/).filter(Boolean)) { const t = cur ? cur + " " + wd : wd; if (measure(t, size) <= w || !cur) cur = t; else { out.push(cur); cur = wd; } }
    out.push(cur); } return out; };
  F.forEach((f, i) => {
    if (seen.has(i)) return;
    if (f.typ === "unterschrift") {
      const sigF = F.filter((g) => g.typ === "unterschrift"), r = rect(f);
      const who = sigF.length < 2 ? ["pascal", "leonie"] : [/leonie/i.test(f.label) ? "leonie" : /pascal/i.test(f.label) ? "pascal" : sigF.indexOf(f) === 0 ? "pascal" : "leonie"];
      const hh = Math.min(Math.max(r.h * 1.3, 20), 28, r.w / who.length / (1500 / 560)), ww = hh * 1500 / 560, gap = Math.min(10, Math.max(0, (r.w - who.length * ww) / 2));
      who.forEach((w, k) => ops.push({ t: "img", who: w, x: r.x + 2 + k * (ww + gap), y: r.y + r.h - hh * 0.85, w: ww, h: hh, fi: i }));
      return;
    }
    const grp = f.gruppe ? F.map((g, j) => [g, j]).filter(([g]) => g.gruppe === f.gruppe) : [[f, i]];
    grp.forEach(([, j]) => seen.add(j));
    const boxes = grp.map(([g]) => rect({ ...g, dx: f.dx, dy: f.dy })), txt = grp.map(([g]) => g.wert).filter(Boolean).join("\n");
    if (!txt.trim()) return;
    let size = f.size || Math.min(10, Math.min(...boxes.map((b) => b.h)) * 0.62);
    for (; size >= 6.5; size -= 0.25) {
      if (boxes.length > 1) { const lines = wrap(txt, size, boxes[0].w - 6); if (lines.length <= boxes.length) { lines.forEach((l, k) => ops.push({ t: "text", s: l, x: boxes[k].x + 3, y: boxes[k].y + boxes[k].h / 2 + size * 0.36, size, fi: i })); return; } continue; }
      const b = boxes[0], lh = size * 1.15, maxLines = Math.max(1, Math.floor((b.h - 2) / lh));
      const lines = maxLines > 1 ? wrap(txt, size, b.w - 6) : [pdfSafe(txt.replace(/\s*\n\s*/g, ", "))];
      if (lines.length <= maxLines && lines.every((l) => measure(l, size) <= b.w - 6)) {
        const top = b.y + (b.h - lines.length * lh) / 2;
        lines.forEach((l, k) => ops.push({ t: "text", s: l, x: b.x + 3, y: top + k * lh + size * 0.86, size, fi: i })); return;
      }
    }
    const b = boxes[0], sz = 6.5, lh = sz * 1.15, cap = Math.max(1, Math.floor((b.h - 2) / lh)) * Math.max(1, boxes.length);
    const lines = wrap(txt, sz, b.w - 6).slice(0, cap);
    lines.forEach((l, k) => { const bb = boxes.length > 1 ? boxes[Math.min(k, boxes.length - 1)] : b, yy = boxes.length > 1 ? bb.y + bb.h / 2 + sz * 0.36 : b.y + (b.h - Math.min(lines.length, cap) * lh) / 2 + k * lh + sz * 0.86;
      ops.push({ t: "text", s: l, x: bb.x + 3, y: yy, size: sz, fi: i, over: true }); });
  });
  return ops;
}
async function formSigImgs() {
  if (FORM.sigs) return FORM.sigs;
  const load = async (p) => { const im = new Image(); im.src = await repoFile(p); await im.decode(); return im; };
  FORM.sigs = { pascal: await load("dossier/unterschriften/pascal.png"), leonie: await load("dossier/unterschriften/leonie.png") };
  return FORM.sigs;
}
async function drawFormPreview() {
  if (!FORM.data || FORM.data.typ !== "scan" || !FORM.canvas || !$("bFormCv")) return;
  const sigs = await formSigImgs().catch(() => null);
  const v = FORM.view || (FORM.view = document.createElement("canvas")); v.width = FW; v.height = FH;
  const ctx = v.getContext("2d"); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(FORM.canvas, 0, 0);
  ctx.setTransform(1 / PT, 0, 0, 1 / PT, 0, 0);
  const meas = (s, z) => { ctx.font = `${z}px Helvetica, Arial, sans-serif`; return ctx.measureText(s).width; };
  const sel = FORM.sel >= 0 ? FORM.data.felder[FORM.sel] : null;
  if (sel) { const [x0, y0, x1, y1] = sel.box; ctx.fillStyle = "rgba(255,200,0,.35)"; ctx.fillRect(x0 * PT + (sel.dx || 0), y0 * PT + (sel.dy || 0), (x1 - x0) * PT, (y1 - y0) * PT); }
  const ops = formOps(meas), over = new Set(ops.filter((o) => o.over).map((o) => o.fi));
  document.querySelectorAll("#bFormBody .sf[data-fi]").forEach((r) => r.classList.toggle("over", over.has(+r.dataset.fi)));
  for (const o of ops) {
    if (o.t === "text") { ctx.font = `${o.size}px Helvetica, Arial, sans-serif`; ctx.fillStyle = o.over ? "#c00" : `rgb(${INKC.map((c) => c * 255).join(",")})`; ctx.fillText(o.s, o.x, o.y); }
    else if (sigs) ctx.drawImage(sigs[o.who], o.x, o.y, o.w, o.h);
  }
  const cv = $("bFormCv"); cv.width = FW / 2; cv.height = FH / 2; cv.getContext("2d").drawImage(v, 0, 0, FW / 2, FH / 2);
  const lupe = $("bFormLupe");
  if (lupe && sel) {
    const [x0, y0, x1, y1] = sel.box, dx = (sel.dx || 0) / PT, dy = (sel.dy || 0) / PT;
    const cw = Math.min(FW, Math.max(x1 - x0 + 120, 420)), cx = Math.max(0, Math.min(FW - cw, (x0 + x1) / 2 + dx - cw / 2));
    const ch = Math.max(y1 - y0 + 40, cw * 0.28), cy = Math.max(0, Math.min(FH - ch, (y0 + y1) / 2 + dy - ch / 2));
    lupe.width = 840; lupe.height = Math.round(840 * ch / cw); lupe.getContext("2d").drawImage(v, cx, cy, cw, ch, 0, 0, lupe.width, lupe.height);
  }
}

// --- Darstellung im Editor ---
function formPanel() {
  return `<div class="panel" id="bForm"><h2>Formular der Verwaltung</h2>
    <p class="hint">Foto oder PDF des Anmeldeformulars. Claude füllt es mit euren Angaben aus, ihr prüft und korrigiert. Das ausgefüllte Formular kommt ins Dossier.</p>
    <div id="bFormBody"></div>
    <div id="bCopyHome"><details class="adv-inner" id="bCopy"><summary>Online-Formular: Angaben zum Kopieren</summary><div id="bCopyBody"></div></details></div></div>`;
}
function renderForm() {
  const el = $("bFormBody"); if (!el) return;
  const pick = (label, cls = "btn") => `<label class="${cls}" for="bFormFile">${label}</label><input type="file" id="bFormFile" accept="image/*,application/pdf" hidden>`;
  if (FORM.state) { el.innerHTML = `<p class="hint fstate" aria-live="polite">${esc(FORM.state)}</p>`; return; }
  if (!FORM.data) { el.innerHTML = `<div class="brow">${pick("Formular ausfüllen (Foto oder PDF)", "btn")}</div>${BEW.ctx.key ? "" : '<p class="hint warnline">Braucht den Claude-Schlüssel (Mehr).</p>'}`; return; }
  const F = FORM.data, firstOf = (f, i) => !f.gruppe || F.felder.findIndex((g) => g.gruppe === f.gruppe) === i;
  el.innerHTML = `${F.typ === "scan" ? `<div class="fprev"><canvas id="bFormCv" aria-label="Vorschau des ausgefüllten Formulars"></canvas></div>` : '<p class="hint">Ausfüllbares PDF erkannt – die Werte werden direkt in die Felder geschrieben.</p>'}
    ${(F.hinweise || []).length ? `<div class="ftitle sm">Hinweise von Claude</div>${F.hinweise.map((h) => `<div class="tip">${esc(h)}</div>`).join("")}` : ""}
    <div class="ftitle sm">Felder${F.typ === "scan" ? " – antippen zum Verschieben" : ""}</div>
    <div class="ffields">${F.felder.map((f, i) => !firstOf(f, i) ? "" : f.typ === "unterschrift" ? `<div class="sf" data-fi="${i}" tabindex="0"><span>${esc(f.label)}</span><em class="hint">Unterschriften Pascal und Leonie</em></div>`
      : `<label class="sf" data-fi="${i}"><span>${esc(f.label)}</span><textarea class="sfin" data-fv="${i}" rows="1">${esc(f.wert || "")}</textarea></label>`).join("")}</div>
    ${F.typ === "scan" ? `<div class="fnudge" id="bFormNudge" hidden><canvas id="bFormLupe"></canvas><div class="fnbtns">
      <button type="button" data-nudge="l" aria-label="Nach links">←</button><button type="button" data-nudge="u" aria-label="Nach oben">↑</button><button type="button" data-nudge="d" aria-label="Nach unten">↓</button><button type="button" data-nudge="r" aria-label="Nach rechts">→</button>
      <button type="button" data-nudge="m" aria-label="Kleiner">A−</button><button type="button" data-nudge="p" aria-label="Grösser">A+</button><button type="button" data-nudge="x" aria-label="Fertig">✓</button></div></div>` : ""}
    <div class="brow"><button type="button" class="btn primary" id="bFormSave">Formular speichern (ins Dossier)</button><button type="button" class="btn" id="bFormDl">Herunterladen</button></div>
    <div class="brow">${pick("Anderes Formular", "linkbtn")}${FORM.saved ? `<span class="hint">Gespeichert ${esc(ago(FORM.saved))}</span>` : ""}</div>`;
  requestAnimationFrame(() => { document.querySelectorAll("#bFormBody textarea.sfin").forEach(sfFit); drawFormPreview(); });
}
function formSelect(i) {
  FORM.sel = i;
  document.querySelectorAll("#bFormBody .sf").forEach((r) => r.classList.toggle("on", +r.dataset.fi === i));
  if ($("bFormNudge")) $("bFormNudge").hidden = i < 0;
  drawFormPreview();
}
function formNudge(k) {
  const F = FORM.data.felder, f = F[FORM.sel]; if (!f) return;
  if (k === "x") return formSelect(-1);
  const group = f.gruppe ? F.filter((g) => g.gruppe === f.gruppe) : [f];
  if (k === "m" || k === "p") {
    const mc = document.createElement("canvas").getContext("2d"), meas = (t, z) => { mc.font = `${z}px Helvetica, Arial, sans-serif`; return mc.measureText(t).width; };
    const cur = f.size || (formOps(meas).find((o) => o.fi === FORM.sel)?.size ?? 9);
    f.size = Math.max(5.5, Math.min(14, cur + (k === "p" ? 0.5 : -0.5)));
  } else group.forEach((g) => { if (k === "l") g.dx = (g.dx || 0) - 1; if (k === "r") g.dx = (g.dx || 0) + 1; if (k === "u") g.dy = (g.dy || 0) - 1; if (k === "d") g.dy = (g.dy || 0) + 1; });
  FORM.dirty = true; drawFormPreview();
}
async function formPdfBytes() {
  await pdfAssets(); const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const color = rgb(INKC[0], INKC[1], INKC[2]);
  if (FORM.data.typ === "acro") {
    const pdf = await PDFDocument.load(FORM.pdf, { ignoreEncryption: true }), form = pdf.getForm();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const sigP = await pdf.embedPng(BEW.assets.sigP), sigL = await pdf.embedPng(BEW.assets.sigL);
    for (const f of FORM.data.felder) {
      let fl; try { fl = form.getField(f.name); } catch { continue; }
      if (f.typ === "unterschrift") {
        for (const w of fl.acroField.getWidgets()) { const r = w.getRectangle(), pg = pdf.getPages().find((p) => p.ref === w.P()) || pdf.getPage(0);
          const hh = Math.min(r.height * 1.4, r.width / 2 / 2.68), ww = hh * 2.68;
          pg.drawImage(sigP, { x: r.x, y: r.y, width: ww, height: hh }); pg.drawImage(sigL, { x: r.x + ww + 6, y: r.y, width: ww, height: hh }); }
      } else if (f.typ === "check") { try { /^(ja|x|true|1)$/i.test(f.wert) ? fl.check() : fl.uncheck(); } catch { } }
      else { try { fl.setText(pdfSafe(f.wert)); } catch { } }
    }
    form.updateFieldAppearances(font); form.flatten();
    return pdf.save();
  }
  const pdf = await PDFDocument.create(), pg = pdf.addPage([595.28, PH]);
  pg.drawImage(await pdf.embedJpg(await canvasBytes(FORM.canvas, 0.82)), { x: 0, y: 0, width: 595.28, height: PH });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const sig = { pascal: await pdf.embedPng(BEW.assets.sigP), leonie: await pdf.embedPng(BEW.assets.sigL) };
  for (const o of formOps((s, z) => font.widthOfTextAtSize(s, z))) {
    if (o.t === "text") pg.drawText(o.s, { x: o.x, y: PH - o.y, size: o.size, font, color });
    else pg.drawImage(sig[o.who], { x: o.x, y: PH - o.y - o.h, width: o.w, height: o.h });
  }
  pdf.setTitle("Anmeldeformular " + (BEW.doc.adresse || "")); pdf.setAuthor("Leonie Meier, Pascal Stadelmann");
  return pdf.save();
}
async function formSave() {
  const b = $("bFormSave"); if (b.disabled) return;
  b.disabled = true; b.textContent = "Speichere …";
  try {
    const bytes = await formPdfBytes();
    if (FORM.canvas && FORM.scanDirty) { await putRepoFile(formPath("scan.jpg"), new Blob([await canvasBytes(FORM.canvas, 0.85)], { type: "image/jpeg" }), `Formular Scan: ${BEW.x.street || BEW.k}`); FORM.scanDirty = false; }
    await putRepoFile(formPath("formular.json"), new Blob([JSON.stringify(FORM.data, null, 1)], { type: "application/json" }), `Formular: ${BEW.x.street || BEW.k}`);
    const datei = bewPath("beilagen/formular-ausgefuellt.pdf");
    await putRepoFile(datei, new Blob([bytes], { type: "application/pdf" }), `Formular ausgefüllt: ${BEW.x.street || BEW.k}`);
    const L = (BEW.doc.beilagen || []).filter((x) => x.id !== "formular-ausgefuellt");
    const old = (BEW.doc.beilagen || []).find((x) => x.id === "formular-ausgefuellt");
    L.push({ id: "formular-ausgefuellt", titel: "Anmeldeformular (ausgefüllt)", datei, nach: old?.nach || "personalien" });
    BEW.doc.beilagen = L;
    if (BEW.doc.auswahl) delete BEW.doc.auswahl["formular-ausgefuellt"];
    await bewSave(true);
    FORM.dirty = false; FORM.saved = new Date().toISOString();
    renderDossier(); toast("Formular gespeichert und im Dossier.", "ok");
  } catch (e) { toast("Speichern fehlgeschlagen: " + e.message, "err"); }
  finally { b.disabled = false; b.textContent = "Formular speichern (ins Dossier)"; }
}
async function formDownload() {
  try { saveBlob(await formPdfBytes(), "application/pdf", `Anmeldeformular_${fileSlug(BEW.x.street || "Wohnung")}.pdf`); }
  catch (e) { toast("Nicht möglich: " + e.message, "err"); }
}
async function formLoad() {   // beim Öffnen der Bewerbung: gespeichertes Formular laden
  FORM.data = null; FORM.canvas = null; FORM.pdf = null; FORM.sel = -1; FORM.state = ""; FORM.saved = null; FORM.dirty = false;
  try {
    FORM.data = JSON.parse(await repoText(formPath("formular.json")));
    if (FORM.data.typ === "scan") { const im = new Image(); im.src = await repoFile(formPath("scan.jpg")); await im.decode();
      const c = document.createElement("canvas"); c.width = FW; c.height = FH; c.getContext("2d").drawImage(im, 0, 0, FW, FH); FORM.canvas = c; }
    else FORM.pdf = await repoBytes(formPath("original.pdf"));
    FORM.saved = FORM.data.at;
  } catch { FORM.data = null; }
  renderForm();
}

// --- Online-Formulare: Angaben zum Kopieren ---
function copyRows() {
  const st = BEW.ctx.stamm, rows = [], yn = (v) => (v ? "ja" : "nein"), chfF = (v) => (v || v === 0 ? "CHF " + Number(v).toLocaleString("de-CH") : "");
  (st.personen || []).forEach((p) => {
    rows.push(["h", `${p.vorname} ${p.nachname}`], ["Name", p.nachname], ["Vorname", p.vorname], ["Geburtsdatum", dmyL(p.geburtsdatum)],
      ["Heimatort", p.heimatort], ["Nationalität", p.nationalitaet], ["Zivilstand", p.zivilstand], ["Telefon", p.telefon], ["E-Mail", p.email]);
    (p.jobs || []).forEach((j) => rows.push(["Beruf", j.titel], ["Arbeitgeber", j.arbeitgeber], ["Adresse Arbeitgeber", j.adresse], ["Pensum", j.pensum],
      ["Angestellt seit", dmyL(j.seit)], ["Befristet bis", dmyL(j.bis)], ["Einkommen brutto", j.brutto_pa]));
    if (p.steuer) rows.push([`Nettoeinkommen (Steuer ${p.steuer.jahr || ""})`, chfF(p.steuer.nettoeinkommen)], [`Reinvermögen (Steuer ${p.steuer.jahr || ""})`, chfF(p.steuer.reinvermoegen)]);
  });
  const w = st.wohnen || {}, h = st.haushalt || {};
  rows.push(["h", "Wohnung und Haushalt"], ["Heutige Adresse", w.adresse], ["Wohnhaft seit", dmyL(w.seit)], ["Mietzins heute (brutto)", chfF(w.miete_brutto)],
    ["Heutige Verwaltung", [w.vermieter, w.kontakt, w.kontakt_telefon, w.kontakt_email].filter(Boolean).join(", ")],
    ["Erwachsene", h.erwachsene], ["Kinder", (st.kinder || []).map((k) => `${k.vorname} (geb. ${dmyL(k.geburt)})`).join(", ")],
    ["Haustiere", yn(h.haustiere)], ["Musikinstrumente", yn(h.musikinstrumente)], ["Rauchen", yn(h.raucher)], ["Fahrzeug", h.fahrzeug]);
  (st.referenzen || []).forEach((r) => rows.push([`Referenz: ${r.rolle || ""}`, [r.name, r.firma, r.telefon, r.email].filter(Boolean).join(", ")]));
  rows.push(["h", "Bemerkung"], ["Bemerkung", bewRead().bemerkung]);
  return rows.filter((r) => r[0] === "h" || (r[1] != null && String(r[1]).trim() !== ""));
}
