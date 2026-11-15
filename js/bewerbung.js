"use strict";
// ---------- Bewerbung: Anschreiben + Bemerkung mit Claude, PDF auf der Canva-Vorlage ----------
// Persönliche Daten (Stammdaten, Vorlage, Schriften, Claude-Schlüssel) liegen nur im privaten Repo unter dossier/.
const BEW = { k: null, aid: null, x: null, d: null, doc: null, sha: null, ctx: null, prev: null, busy: false };
const ANREDEN = ["Guten Tag", "Liebe Frau", "Lieber Herr", "Sehr geehrte Frau", "Sehr geehrter Herr", "Sehr geehrte Damen und Herren"];
const bewPath = (f = "anschreiben.json") => `archiv/${BEW.aid}/bewerbung/${f}`;
const anredeZeile = (a, n) => (n && a !== "Sehr geehrte Damen und Herren" ? `${a} ${n.trim()}` : a);



async function repoText(path) { const d = await gh(path); return b64decode(d.content); }
async function bewCtx() {
  if (BEW.ctx) return BEW.ctx;
  const [stamm, stil, vorlage] = await Promise.all([readJson("dossier/stammdaten.json"), repoText("dossier/stil/texte.md"), readJson("dossier/vorlage/anschreiben.json")]);
  BEW.ctx = { stamm: stamm.data, stil, vorlage: vorlage.data, key: null, regeln: [], fertige: [] };
  try { BEW.ctx.key = (await readJson("dossier/ki.json")).data.anthropic_key || null; } catch { }
  try { BEW.ctx.regeln = (await readJson(LERN_PATH)).data.regeln || []; } catch { }
  try { BEW.ctx.fertige = (await readJson(FERTIG_PATH)).data.anschreiben || []; } catch { }
  try { BEW.ctx.bausteine = (await readJson("dossier/bausteine.json")).data.bausteine || []; } catch { BEW.ctx.bausteine = []; }
  return BEW.ctx;
}
function bewNew() {
  const x = BEW.x, v = BEW.ctx.vorlage;
  const ort = [x.plz, (x.city || "Zürich").replace(/^Zurich$/, "Zürich")].filter(Boolean).join(" ");
  return { adresse: [x.street, ort].filter(Boolean).join(", ") || "[Adresse]", anrede: v.anrede || "Guten Tag", name: "",
    text: v.text, bemerkung: "", hinweise: [], created: new Date().toISOString(), ki: { text: v.text, bemerkung: "" } };
}
// Früher eigenes Fenster; heute öffnet das die Wohnung im Tab «Bewerbung»
async function openBew(k) {
  if ($("detail").hidden || S.detailKey !== k) await openDetail(k);
  if (S.detailKey !== k) return;
  S.dTab = "bewerbung"; refreshStand(k);
}
async function bewLoad(k) {
  BEW.k = k; BEW.doc = null; BEW.x = S.hits.find((h) => keyOf(h) === k) || {}; BEW.aid = await aidOf(k); BEW.open = null; BEW.edit = new Set(); BEW.pundo = null;
  $("bBody").innerHTML = '<p class="hint">Lade …</p>';
  const a = archEntry(BEW.x); BEW.d = null;
  if (a) { try { BEW.d = (await readJson(`archiv/${a.id}/data.json`)).data; } catch { } }
  if (BEW.k !== k) return;
  try { await bewCtx(); } catch (e) { $("bBody").innerHTML = `<p class="hint">Dossier nicht ladbar: ${esc(e.message)}</p>`; return; }
  try { const r = await readJson(bewPath()); BEW.doc = r.data; BEW.sha = r.sha; } catch { BEW.doc = bewNew(); BEW.sha = null; }
  if (!BEW.doc.ki) BEW.doc.ki = { text: BEW.doc.text, bemerkung: BEW.doc.bemerkung || "" };
  BEW.prev = null; BEW.saved = bewFields();
  if (BEW.k !== k) return;
  renderBew(); formLoad();
}
// Bewerbung v89 (Pascal 14.11.): eine Seite mit Teilen, Texte nur lesbar bis «Bearbeiten»; danach «Speichern» oder «Prüfen».
// «Prüfen» liefert Vorschläge (Übernehmen/Verwerfen/Alle übernehmen). Die Textfelder bleiben im DOM (versteckt), damit alles andere weiterläuft.
function bpPart(id, title, body) {
  const open = BEW.open?.has(id);
  return `<div class="panel bp-part${open ? " open" : ""}" data-bpart="${id}">
    <button type="button" class="bp-head" data-bptoggle="${id}" aria-expanded="${open}"><b>${title}</b><span class="bp-st" id="bpSt-${id}"></span><span class="bp-chev" aria-hidden="true">›</span></button>
    <div class="bp-body">${body}</div></div>`;
}
function bpTextBar(feld) {
  return `<div class="bp-bar" data-tbar="${feld}"></div><div class="bp-pruef" id="bPruef-${feld}"></div>`;
}
function renderBew() {
  const doc = BEW.doc;
  if (!BEW.open) BEW.open = new Set([doc.updated ? "" : "anschreiben"].filter(Boolean));
  BEW.edit = BEW.edit || new Set();
  const neu = !doc.updated && doc.text === BEW.ctx.vorlage?.text;
  $("bBody").innerHTML = `
    <div class="panel" id="bClaude">
      ${BEW.ctx.key ? "" : '<p class="hint warnline">Noch kein Claude-Schlüssel hinterlegt: Mehr → «Claude für Bewerbungen». Ihr könnt trotzdem schreiben.</p>'}
      <button type="button" class="btn ki" data-ki="entwurf">${neu ? "✦ Entwurf für diese Wohnung" : "✦ Neuen Entwurf schreiben lassen"}</button>
      <p class="hint" id="bState" aria-live="polite"></p>
      <div id="bLearn"></div><div id="bTips"></div><div id="bDiff"></div>
    </div>
    ${bpPart("anschreiben", "Anschreiben", `
      <div class="bp-read" id="bRead-text"></div>
      <div class="bp-edit" data-tedit="text" hidden>
        <label class="f" for="bAdr"><small>Adresse unter «Wohnungsbewerbung»</small><input class="field" id="bAdr" value="${esc(doc.adresse)}"></label>
        <div class="row2">
          <label class="f" for="bAnrede"><small>Anrede</small><select class="field" id="bAnrede">${ANREDEN.map((a) => `<option${a === doc.anrede ? " selected" : ""}>${a}</option>`).join("")}</select></label>
          <label class="f" for="bName"><small>Name</small><input class="field" id="bName" value="${esc(doc.name || "")}" placeholder="z.B. Muster"></label>
        </div>
        <textarea class="field bewtext" id="bText" spellcheck="true" lang="de-CH">${esc(doc.text)}</textarea>
        <p class="hint">Absätze mit einer Leerzeile trennen. Text in [eckigen Klammern] ist noch offen und erscheint im PDF blau.</p>
        <button type="button" class="linkbtn" id="bGrund" style="justify-self:start">Diese Fassung als Grundtext für künftige Bewerbungen übernehmen</button>
      </div>
      ${bpTextBar("text")}
      <div class="kbar"><button type="button" class="btn sm" id="bPdf">PDF ansehen</button><span id="bPdfLink">${doc.pdf ? `<a href="#" class="doclink" data-doc="${esc(doc.pdf)}">📄 Gespeichertes PDF (${esc(ago(doc.pdf_at))})</a>` : ""}</span></div>`)}
    ${bpPart("foto", "Foto", `<div class="panel" id="bFoto"><div id="bFotoBody"></div></div>`)}
    ${bpPart("unterlagen", "Unterlagen", `
      <div class="panel" id="bDossier"><h2>Dossier</h2>
        <details class="dosdet" id="bDossierDet"><summary id="bDossierSum">Dokumente</summary>
          <p class="hint">Häkchen = kommt ins Dossier. ⬇ lädt ein Dokument einzeln herunter (für Plattformen mit Einzel-Upload).</p>
          <div id="bDossierList"></div></details>
        <div class="kbar"><label class="btn sm" for="bUpload">+ Weiteres Dokument</label><input type="file" id="bUpload" accept="application/pdf,image/*" multiple hidden></div>
      </div>
      ${formPanel()}
      <details class="panel adv" id="bStamm"><summary>Personalien &amp; Referenzen</summary>
        <div class="advbody"><p class="hint">Gilt für alle Bewerbungen und für die Personalien-Seite im Dossier.</p><div id="bStammBody"></div></div>
      </details>`)}
    ${bpPart("begleit", "Begleit-Mail", `
      <p class="hint">Kurzer Text, mit dem ihr das Dossier schickt – als Mail oder im Feld «Bemerkung» eines Online-Formulars.</p>
      <div class="bp-read" id="bRead-bemerkung"></div>
      <div class="bp-edit" data-tedit="bemerkung" hidden>
        <label class="f" for="bBetreff"><small>Betreff (für die Mail)</small><input class="field" id="bBetreff" value="${esc(doc.betreff || "")}" placeholder="${esc(bpBetreffVor())}"></label>
        <textarea class="field bewnote" id="bNote" spellcheck="true" lang="de-CH" placeholder="Wird mit «Entwurf für diese Wohnung» erstellt.">${esc(doc.bemerkung || "")}</textarea>
        <div class="kbar"><span class="hint" id="bCount"></span></div>
      </div>
      ${bpTextBar("bemerkung")}
      <div class="kbar"><button type="button" class="btn sm" id="bNoteCopy">Text kopieren</button></div>`)}
    ${bpPart("senden", "Senden & Dateien", `<div id="bSendBody"></div>`)}
    <div class="bewfoot"><span class="hint warnline" id="bDirty" hidden>Nicht gespeichert</span><button type="button" class="btn sm" id="bSave">Gespeichert</button></div>`;
  bewTips(); bewCount(); renderDossier(); renderStamm(); renderForm(); renderCopy(); bewMark(); dossierSum(); FOTO.img = null; fotoRender();
  bpRenderText("text"); bpRenderText("bemerkung"); renderSend(); bpStatus();
}
const bpBetreffVor = () => `Bewerbung ${[BEW.x?.street, BEW.x?.rooms ? BEW.x.rooms + " Zimmer" : ""].filter(Boolean).join(", ")}`.trim();
// Texte lesen / bearbeiten / prüfen (v89 Bewerbung, v90 auch Kontakt-Nachricht). Felder: text, bemerkung (BEW.doc), kontakt (KON.data).
const TX_TA = { text: "bText", bemerkung: "bNote", kontakt: "kText" };
const TX = {
  get(feld) { return feld === "kontakt" ? ($("kText") && KON.edit ? $("kText").value : KON.data?.text || "") : (feld === "text" ? BEW.doc?.text : BEW.doc?.bemerkung) || ""; },
  set(feld, t) {
    if (feld === "kontakt") { KON.data = { ...(KON.data || {}), text: t }; if ($("kText")) $("kText").value = t; KON.draft = null; return; }
    BEW.doc[feld] = t; if ($(TX_TA[feld])) $(TX_TA[feld]).value = t;
  },
  pruef(feld) { return feld === "kontakt" ? KON.data?.pruef : BEW.doc?.pruef?.[feld]; },
  setPruef(feld, p) {
    if (feld === "kontakt") KON.data = { ...(KON.data || {}), pruef: p };
    else BEW.doc.pruef = { ...(BEW.doc.pruef || {}), [feld]: p };
  },
  editing(feld) { return feld === "kontakt" ? KON.edit : !!BEW.edit?.has(feld); },
  persist(feld) {
    if (feld === "kontakt") return kontaktSave(KON.k, ($("kText")?.value ?? KON.data?.text ?? "").trim(), true);
    return bewSave(true);
  },
  after(feld) {
    if (feld === "kontakt") return;
    BEW.doc.ki = { text: BEW.doc.text, bemerkung: BEW.doc.bemerkung || "", at: new Date().toISOString() };  // Übernahme von Claude: nicht «lernen»
    bewCount();
  },
};
// Lese-Ansicht: sieht aus wie das fertige Schreiben; [Platzhalter] blau, Prüf-Vorschläge markiert
function bpMarkup(feld) {
  const t = TX.get(feld);
  let h = esc(t);
  bpOpen(feld).forEach(({ v, i }) => { const a = esc(v.alt); if (a && h.includes(a)) h = h.replace(a, `<mark class="bp-mk" data-pv="${feld}:${i}">${a}</mark>`); });
  h = h.replace(/\[[^\]<]*\]/g, (m) => `<span class="bp-ph">${m}</span>`);
  return h.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}
function txRender(feld) {
  const el = $("bRead-" + feld); if (!el) return;
  const editing = TX.editing(feld), empty = !TX.get(feld).trim();
  el.hidden = editing; document.querySelector(`[data-tedit="${feld}"]`).hidden = !editing;
  if (!editing) {
    const doc = BEW.doc;
    el.innerHTML = feld === "text"
      ? `<div class="bp-meta">${esc(doc.adresse || "")}</div><p>${esc(anredeZeile(doc.anrede, doc.name))}</p>${bpMarkup("text")}`
      : empty ? `<p class="hint">Noch leer – ${feld === "kontakt" ? "«✦ Entwurf schreiben»" : "«✦ Entwurf für diese Wohnung»"} oder «Bearbeiten».</p>`
      : feld === "bemerkung" ? `<div class="bp-meta">Betreff: ${esc(doc.betreff || bpBetreffVor())}</div>${bpMarkup("bemerkung")}`
      : bpMarkup(feld);
  }
  const bar = document.querySelector(`[data-tbar="${feld}"]`);
  const chk = empty && !editing ? "" : `<button type="button" class="btn sm ki" data-tcheck="${feld}">Prüfen</button>`;
  bar.innerHTML = editing
    ? `<button type="button" class="btn sm primary" data-tsave="${feld}">Speichern</button>${chk}<button type="button" class="linkbtn" data-tcancel="${feld}">Abbrechen</button>`
    : `<button type="button" class="btn sm" data-tedit-on="${feld}">Bearbeiten</button>${chk}`
      + (feld === "kontakt" ? `${empty ? "" : `<button type="button" class="btn sm" id="kCopy">Kopieren</button>`}<button type="button" class="btn sm ki" id="kKi">${empty ? "✦ Entwurf schreiben" : "✦ Neu schreiben"}</button>` : "");
  bpRenderPruef(feld);
}
const bpRenderText = txRender;
function bpEdit(feld, on) {
  if (feld === "kontakt") {
    if (on) { KON.snap = KON.data?.text || ""; $("kText").value = KON.data?.text || ""; KON.draft = null; }
    KON.edit = on; saveBtnState();
  } else {
    if (on) { bewRead(); BEW.snap = BEW.snap || {}; BEW.snap[feld] = JSON.stringify(BEW.doc); BEW.edit.add(feld); }
    else BEW.edit.delete(feld);
    bpStatus();
  }
  txRender(feld);
  if (on) { const ta = $(TX_TA[feld]); setTimeout(() => { ta.focus({ preventScroll: true }); ta.scrollIntoView({ block: "center", behavior: "smooth" }); }, 30); }
}
function bpCancel(feld) {
  if (feld === "kontakt") { $("kText").value = KON.snap ?? KON.data?.text ?? ""; KON.draft = null; bpEdit(feld, false); return; }
  const s = BEW.snap?.[feld] ? JSON.parse(BEW.snap[feld]) : null;
  if (s) {
    if (feld === "text") { $("bAdr").value = s.adresse || ""; $("bAnrede").value = s.anrede; $("bName").value = s.name || ""; $("bText").value = s.text || ""; }
    else { $("bBetreff").value = s.betreff || ""; $("bNote").value = s.bemerkung || ""; }
    bewRead(); bewCount(); bewMark();
  }
  bpEdit(feld, false);
}
async function bpSave(feld) {
  if (feld === "kontakt") { await kontaktSave(KON.k, $("kText").value.trim(), false); KON.draft = null; bpEdit(feld, false); return; }
  bewLearnMaybe(); await bewSave(false); bpEdit(feld, false);
}
// --- Prüfen ---
const PRUEF_TOOL = { name: "pruefung", description: "Vorschläge zum geprüften Text. Der Text selbst wird nicht geändert.",
  input_schema: { type: "object", required: ["vorschlaege"], properties: {
    vorschlaege: { type: "array", items: { type: "object", required: ["alt", "neu", "grund"], properties: {
      alt: { type: "string", description: "wörtliches, kurzes Zitat aus dem Text, das genau einmal vorkommt (ganze Wörter)" },
      neu: { type: "string", description: "Ersatz für «alt» (leer = streichen)" },
      grund: { type: "string", description: "wenige Worte, warum" },
      art: { type: "string", enum: ["rechtschreibung", "stil", "inhalt"] } } } },
    zu_klaeren: { type: "array", items: { type: "object", required: ["text"], properties: { stelle: { type: "string" }, text: { type: "string" } } } } } } };
const PRUEF_REGELN = `Ändere ihn nicht selbst, sondern liefere jede Verbesserung als Vorschlag:
- «alt»: wörtliches, möglichst kurzes Zitat aus dem Text (ganze Wörter, kommt genau einmal vor), «neu»: der Ersatz (leer = streichen), «grund»: wenige Worte.
- Prüfe: Rechtschreibung, Grammatik, Zeichensetzung (Schweizer Schreibweise), den Nach-Check Textstil (künstlich wirkende Sätze → einfacher, konkreter Ersatz in ihrem Ton), falsche oder veraltete Fakten und Widersprüche zu Stammdaten und Inserat, Länge.
- Höchstens 12 Vorschläge, die wichtigsten zuerst. Nur echte Verbesserungen – ihr Wortlaut hat Vorrang.
- Was sie selbst entscheiden müssen und sich nicht als Ersatz schreiben lässt, kommt in «zu_klaeren» (höchstens 3, je ein Satz).
- Keine Vorschläge zu offenen [Platzhaltern]. Ist alles gut: leere Listen.
Antworte für diesen Auftrag mit dem Werkzeug «pruefung».`;
function bpOpen(feld) {
  const p = TX.pruef(feld); if (!p) return [];
  const t = TX.get(feld);
  return (p.vorschlaege || []).map((v, i) => ({ v, i })).filter(({ v }) => v.st === "offen" && v.alt && t.includes(v.alt));
}
const TXBUSY = new Set();
async function bpCheck(feld) {
  if (TXBUSY.has(feld) || (feld !== "kontakt" && BEW.busy)) return;
  const c = await bewCtx();
  if (!c.key) { toast("Zuerst den Claude-Schlüssel hinterlegen (Mehr).", "err"); return; }
  if (feld !== "kontakt") bewRead();
  if (!TX.get(feld).trim()) { toast("Der Text ist noch leer.", "err"); return; }
  if (TX.editing(feld)) {
    if (feld === "kontakt") { KON.edit = false; KON.draft = null; saveBtnState(); }
    else { bewLearnMaybe(); BEW.edit.delete(feld); }
    txRender(feld);
  }
  if (feld === "kontakt") { if ((KON.data?.text || "") !== $("kText").value.trim()) await kontaktSave(KON.k, $("kText").value.trim(), true); }
  else if (bewDirty()) await bewSave(true);
  TXBUSY.add(feld); if (feld !== "kontakt") BEW.busy = true;
  const box = $("bPruef-" + feld); box.innerHTML = `<p class="hint">Claude prüft … (ca. 20–40 Sek.)</p>`;
  const k = feld === "kontakt" ? KON.k : BEW.k;
  try {
    const res = feld === "kontakt"
      ? await claudeTool(BEW_SYSTEM, kontaktUser(c, `Prüfe die Kontakt-Nachricht unter <aktuell> (Erstkontakt vor der Besichtigung), die Leonie oder Pascal geschrieben haben. ${PRUEF_REGELN}`), PRUEF_TOOL, "vorschlaege")
      : await claudeCall("pruefung", feld);
    if ((feld === "kontakt" ? KON.k : BEW.k) !== k) return;
    const vs = (res.vorschlaege || []).filter((v) => v && v.alt && v.alt !== v.neu).slice(0, 12).map((v) => ({ alt: String(v.alt), neu: String(v.neu ?? ""), grund: v.grund || "", art: v.art || "stil", st: "offen" }));
    const kl = (res.zu_klaeren || []).filter((x) => x && x.text).slice(0, 3).map((x) => ({ stelle: x.stelle || "", text: x.text, st: "offen" }));
    TX.setPruef(feld, { at: new Date().toISOString(), by: S.person, vorschlaege: vs, klaeren: kl, basis: TX.get(feld) });
    if (TXUNDO?.feld === feld) TXUNDO = null;
    await TX.persist(feld);
    txRender(feld); if (feld !== "kontakt") bpStatus();
    const n = bpOpen(feld).length + kl.length;
    toast(n ? `${n} Vorschl${n === 1 ? "ag" : "äge"}` : "Alles in Ordnung", "ok");
    const tgt = $("bPruef-" + feld); if (tgt) { tgt.scrollIntoView({ behavior: "smooth", block: "nearest" }); tgt.classList.add("act-flash"); setTimeout(() => tgt.classList.remove("act-flash"), 1700); }
  } catch (e) { if ($("bPruef-" + feld)) $("bPruef-" + feld).innerHTML = `<p class="hint warnline">Prüfen fehlgeschlagen: ${esc(e.message)}</p>`; toast("Claude: " + e.message, "err", 7000); }
  finally { TXBUSY.delete(feld); if (feld !== "kontakt") BEW.busy = false; }
}
function bpRenderPruef(feld) {
  const box = $("bPruef-" + feld); if (!box) return;
  const p = TX.pruef(feld);
  if (!p) { box.innerHTML = ""; return; }
  const open = bpOpen(feld), kl = (p.klaeren || []).map((k, i) => ({ k, i })).filter(({ k }) => k.st === "offen");
  const undo = TXUNDO?.feld === feld ? `<button type="button" class="linkbtn" data-pundo>Rückgängig</button>` : "";
  if (!open.length && !kl.length) { box.innerHTML = `<p class="bp-okline">✓ Geprüft${p.at ? " " + esc(ago(p.at)) : ""} – keine offenen Vorschläge. ${undo}</p>`; return; }
  const ART = { rechtschreibung: "Rechtschreibung", stil: "Stil", inhalt: "Inhalt" };
  box.innerHTML = (open.length ? `<div class="bp-vhead"><span class="ftitle sm">Vorschläge von Claude (${open.length})</span>${open.length > 1 ? `<button type="button" class="btn sm primary" data-pall="${feld}">Alle übernehmen</button>` : ""}</div>
    ${open.map(({ v, i }) => `<div class="bp-v" data-pvrow="${feld}:${i}">
      <div class="bp-vtext" role="button" tabindex="0" data-pgo="${feld}:${i}"><del>${esc(v.alt)}</del> → ${v.neu ? `<ins>${esc(v.neu)}</ins>` : "<i>streichen</i>"}<small>${esc(ART[v.art] || "")}${v.grund ? " · " + esc(v.grund) : ""}</small></div>
      <div class="bp-vbtn"><button type="button" class="btn sm" data-pok="${feld}:${i}">Übernehmen</button><button type="button" class="btn sm" data-pno="${feld}:${i}">Verwerfen</button></div></div>`).join("")}` : "")
    + (kl.length ? `<div class="ftitle sm">Zu klären</div>${kl.map(({ k, i }) => `<div class="tip bp-k">${esc(k.text)}<button type="button" class="linkbtn" data-kok="${feld}:${i}">Erledigt</button></div>`).join("")}` : "")
    + (undo ? `<p>${undo}</p>` : "");
}
let TXUNDO = null;
function txRefresh(feld) { txRender(feld); if (feld !== "kontakt") bpStatus(); }
function bpApply(feld, idxs) {
  const p = TX.pruef(feld); if (!p) return;
  if (feld !== "kontakt") bewRead();
  TXUNDO = { feld, text: TX.get(feld), states: p.vorschlaege.map((v) => v.st) };
  let t = TX.get(feld), n = 0;
  for (const i of idxs) {
    const v = p.vorschlaege[i]; if (!v || v.st !== "offen") continue;
    const at = t.indexOf(v.alt);
    if (at < 0) { v.st = "weg"; continue; }
    t = t.slice(0, at) + v.neu + t.slice(at + v.alt.length);
    if (!v.neu) t = t.replace(/ {2,}/g, " ").replace(/ ([.,;:!?])/g, "$1").replace(/ +\n/g, "\n").replace(/\n +/g, "\n");
    v.st = "ok"; n++;
  }
  TX.set(feld, t);
  if (!bpOpen(feld).length) p.basis = t;
  TX.after(feld); txRefresh(feld);
  TX.persist(feld).then(() => { txRefresh(feld); toast(n === 1 ? "Übernommen" : `${n} übernommen`, "ok"); });
}
function bpUndo() {
  const u = TXUNDO; if (!u) return;
  const p = TX.pruef(u.feld);
  TX.set(u.feld, u.text);
  if (p) u.states.forEach((s, i) => { if (p.vorschlaege[i]) p.vorschlaege[i].st = s; });
  TX.after(u.feld); TXUNDO = null; txRefresh(u.feld);
  TX.persist(u.feld).then(() => { txRefresh(u.feld); toast("Rückgängig gemacht", "ok"); });
}
document.addEventListener("click", (e) => {
  const t = e.target, q = (sel) => t.closest(sel);
  let b;
  if ((b = q("[data-tedit-on]"))) { if (b.dataset.teditOn === "kontakt" && needPerson()) return; bpEdit(b.dataset.teditOn, true); return; }
  if ((b = q("[data-tcancel]"))) { bpCancel(b.dataset.tcancel); return; }
  if ((b = q("[data-tsave]"))) { bpSave(b.dataset.tsave); return; }
  if ((b = q("[data-tcheck]"))) { bpCheck(b.dataset.tcheck); return; }
  if ((b = q("[data-pall]"))) { const f = b.dataset.pall; bpApply(f, bpOpen(f).map((o) => o.i)); return; }
  if ((b = q("[data-pok]"))) { const [f, i] = b.dataset.pok.split(":"); bpApply(f, [+i]); return; }
  if ((b = q("[data-pno]"))) { const [f, i] = b.dataset.pno.split(":"); TX.pruef(f).vorschlaege[+i].st = "nein"; txRefresh(f); TX.persist(f); return; }
  if ((b = q("[data-kok]"))) { const [f, i] = b.dataset.kok.split(":"); TX.pruef(f).klaeren[+i].st = "ok"; txRefresh(f); TX.persist(f); return; }
  if (q("[data-pundo]")) { bpUndo(); return; }
  if ((b = q("[data-pgo]")) || (b = q("mark[data-pv]"))) {
    const [f, i] = (b.dataset.pgo || b.dataset.pv).split(":");
    const other = b.dataset.pgo ? document.querySelector(`mark[data-pv="${f}:${i}"]`) : document.querySelector(`[data-pvrow="${f}:${i}"]`);
    if (other) { other.scrollIntoView({ block: "center", behavior: "smooth" }); other.classList.add("act-flash"); setTimeout(() => other.classList.remove("act-flash"), 1500); }
  }
});
// Status je Teil (Kopfzeile)
function bpTextSt(feld) {
  const t = feld === "text" ? BEW.doc.text || "" : BEW.doc.bemerkung || "";
  if (!t.trim()) return ["noch leer", "muted"];
  if (BEW.edit.has(feld)) return ["wird bearbeitet", "warn"];
  const p = BEW.doc.pruef?.[feld], open = bpOpen(feld).length + (p?.klaeren || []).filter((k) => k.st === "offen").length;
  const ph = (t.match(/\[[^\]]*\]/g) || []).length;
  if (open) return [`${open} Vorschl${open === 1 ? "ag" : "äge"} offen`, "warn"];
  if (ph) return [`${ph} Platzhalter offen`, "warn"];
  if (p && p.basis === t) return ["geprüft ✓", "ok"];
  return [p ? "geändert" : "ungeprüft", "muted"];
}
function bpStatus() {
  const set = (id, [txt, cls]) => { const el = $("bpSt-" + id); if (el) { el.textContent = txt; el.className = "bp-st " + cls; } };
  if (!$("bpSt-anschreiben")) return;
  set("anschreiben", bpTextSt("text"));
  set("begleit", bpTextSt("bemerkung"));
  set("foto", BEW.doc.foto?.path ? ["eigenes Foto", "ok"] : ["Standardfoto", "muted"]);
  const items = dossierItems().filter(dossierOn), old = items.filter((b) => baustAlter(b)?.alt).length;
  set("unterlagen", [`${items.length} Dokumente${old ? ` · ${old} zu alt` : ""}`, old ? "warn" : "ok"]);
  const wg = WEGE.find(([w]) => w === (BEW.doc.weg || sendWegVorschlag()[0]))?.[1] || "";
  set("senden", stepsOf(BEW.k).bewerbung ? ["verschickt ✓", "ok"] : [(BEW.doc.weg ? "" : "✦ ") + wg.replace("Per ", "").replace(" / Flatfox", ""), "muted"]);
}
function bpToggle(id, force) {
  const el = document.querySelector(`[data-bpart="${id}"]`); if (!el) return;
  const on = force ?? !el.classList.contains("open");
  el.classList.toggle("open", on); el.querySelector(".bp-head").setAttribute("aria-expanded", on);
  if (on) BEW.open.add(id); else BEW.open.delete(id);
  if (on && id === "unterlagen") sfFitAll?.();
}
// Zusammenfassung des Dossiers: «11 Dokumente · alles gültig»
function dossierSum() {
  const items = dossierItems().filter(dossierOn), old = items.filter((b) => baustAlter(b)?.alt).length;
  const t = `${items.length} Dokument${items.length === 1 ? "" : "e"} im Dossier · ${old ? `${old} zu alt` : "alles gültig"}`;
  if ($("bDossierSum")) $("bDossierSum").innerHTML = `${esc(t)} <span class="chg">ändern ›</span>`;
  if ($("bDossierSum2")) $("bDossierSum2").textContent = t;
  $("bDossierSum")?.classList.toggle("warnline", !!old);
  bpStatus();
}
function bewRead() {
  if (!$("bText")) return BEW.doc;
  Object.assign(BEW.doc, { adresse: $("bAdr").value.trim(), anrede: $("bAnrede").value, name: $("bName").value.trim(),
    text: $("bText").value.replace(/\r/g, ""), bemerkung: $("bNote").value.replace(/\r/g, ""), betreff: ($("bBetreff")?.value || "").trim() });
  return BEW.doc;
}
function bewCount() { const n = ($("bNote")?.value || "").length; if ($("bCount")) $("bCount").textContent = n ? `${n} Zeichen` : ""; }
$("bBody").addEventListener("input", (e) => { if (e.target.id === "bNote") bewCount(); if (/^b(Text|Note|Adr|Name|Betreff)$/.test(e.target.id)) bewMark(); });
$("bBody").addEventListener("click", (e) => {
  const t = e.target, q = (sel) => t.closest(sel);
  let b;
  if ((b = q("[data-bptoggle]"))) { bpToggle(b.dataset.bptoggle); return; }
  if ((b = q("[data-tipdone]"))) { BEW.doc.hinweise = (BEW.doc.hinweise || []).filter((h) => !String(h.text || "").startsWith(b.dataset.tipdone)); bewTips(); bewSave(true); return; }
});
$("bBody").addEventListener("change", (e) => {
  if (e.target.id === "bAnrede") bewMark();
  if (e.target.matches("[data-dsel]")) { BEW.doc.auswahl = { ...(BEW.doc.auswahl || {}), [e.target.dataset.dsel]: e.target.checked }; bewMark(); dossierSum(); renderDossier(); renderSend(); }
  if (e.target.id === "bUpload" && e.target.files.length) { beilageUpload(e.target.files); e.target.value = ""; }
  if (e.target.id === "bFormFile" && e.target.files.length) { const f = e.target.files[0]; e.target.value = ""; formStart(f); }
});
// Gespeichert wird nur mit «Speichern» (und beim PDF). Schliessen mit ✕ verwirft nach Rückfrage.
const bewFields = () => { const d = BEW.doc || {}; return JSON.stringify([d.adresse, d.anrede, d.name, d.text, d.bemerkung || "", d.betreff || "", d.auswahl || {}, d.beilagen || []]); };
function bewDirty() { if (!$("bText")) return false; bewRead(); return bewFields() !== BEW.saved; }
function bewMark() {
  const b = $("bSave"); if (!b) return;
  const dirty = bewDirty();
  b.classList.toggle("primary", dirty); b.textContent = dirty ? "Speichern" : "Gespeichert";
  if ($("bDirty")) $("bDirty").hidden = !dirty;
  b.closest(".bewfoot")?.classList.toggle("bp-clean", !dirty);
}
async function bewSave(quiet) {
  bewRead();
  BEW.doc.updated = new Date().toISOString(); BEW.doc.by = S.person;
  const msg = `Bewerbung: ${BEW.x.street || BEW.k}`;
  try { BEW.sha = await writeJson(bewPath(), BEW.doc, BEW.sha, msg); }
  catch (e) {
    if (e.status !== 409) { toast("Speichern fehlgeschlagen: " + e.message, "err"); return; }
    try { BEW.sha = (await readJson(bewPath())).sha; BEW.sha = await writeJson(bewPath(), BEW.doc, BEW.sha, msg); }
    catch (e2) { toast("Speichern fehlgeschlagen: " + e2.message, "err"); return; }
  }
  BEW.saved = bewFields(); bewMark();
  if (!quiet) toast("Gespeichert.", "ok");
}
$("bBody").addEventListener("click", async (e) => {
  if (e.target.id === "bSave") { bewLearnMaybe(); return bewSave(false); }
  if (e.target.id === "bGrund") return bewGrundtext();
  if (e.target.id === "bDossierPdf") return dossierPdf();
  if (e.target.id === "bFormSave") return formSave();
  if (e.target.id === "bFormDl") return formDownload();
  const nb = e.target.closest("[data-nudge]"); if (nb) return formNudge(nb.dataset.nudge);
  const cp = e.target.closest("[data-copy]");
  if (cp) { const v = String(BEW.copy[+cp.dataset.copy][1]); try { await navigator.clipboard.writeText(v); toast("Kopiert: " + BEW.copy[+cp.dataset.copy][0], "ok", 1500); } catch { toast("Kopieren nicht möglich.", "err"); } return; }
  const fr = e.target.closest("#bFormBody .sf[data-fi]"); if (fr) formSelect(+fr.dataset.fi);
  if (e.target.id === "spSave") return stammSave();
  const dlb = e.target.closest("[data-dl]"); if (dlb) return dossierDownload(dlb.dataset.dl);
  const mvb = e.target.closest("[data-mv]"); if (mvb) return dossierMove(mvb.dataset.mv, +mvb.dataset.dir);
  const bdel = e.target.closest("[data-bdel]");
  if (bdel) { BEW.doc.beilagen = (BEW.doc.beilagen || []).filter((b) => b.id !== bdel.dataset.bdel); renderDossier(); bewMark(); return; }
  const sadd = e.target.closest("[data-spadd]");
  if (sadd) { stammCollect(); const L = spGet(BEW.ctx.stamm, sadd.dataset.spadd) || []; L.push({}); spSet(BEW.ctx.stamm, sadd.dataset.spadd, L); renderStamm(); return; }
  const sdel = e.target.closest("[data-spdel]");
  if (sdel) { stammCollect(); const p = sdel.dataset.spdel.split("."), i = +p.pop(); spGet(BEW.ctx.stamm, p.join(".")).splice(i, 1); renderStamm(); return; }
  if (e.target.id === "bLearnOk" || e.target.id === "bLearnNo") return bewLearnDecide(e.target.id === "bLearnOk");
  if (e.target.id === "bNoteCopy") {
    const offen = ($("bNote").value.match(/\[[^\]]*\]/g) || []);
    if (offen.length && !confirm(`In der Bemerkung steht noch: ${offen.join(", ")}\n\nTrotzdem kopieren?`)) return;
    try { await navigator.clipboard.writeText($("bNote").value); toast("Bemerkung kopiert.", "ok"); } catch { $("bNote").select(); toast("Markiert – jetzt kopieren.", ""); } return; }
  if (e.target.id === "bPdf") return bewPdf();
  if (e.target.id === "bUndo") { bewUndo(); return; }
  const dl = e.target.closest("[data-doc]");
  if (dl) { e.preventDefault(); openDoc(dl.dataset.doc, dl.textContent.replace(/^📄\s*/, "")); return; }
  const tip = e.target.closest("[data-stelle]"); if (tip) { bewShow(tip.dataset.stelle); return; }
  if (e.target.closest("[data-ki]")) bewKi();
});
let formTimer = null;
$("bBody").addEventListener("input", (e) => {
  if (e.target.matches("textarea.sfin")) sfFit(e.target);
  if (e.target.matches("[data-fv]")) { FORM.data.felder[+e.target.dataset.fv].wert = e.target.value; FORM.dirty = true; clearTimeout(formTimer); formTimer = setTimeout(drawFormPreview, 250); }
});
$("bBody").addEventListener("focusin", (e) => { const t = e.target.closest("#bFormBody [data-fi]"); if (t && FORM.sel !== +t.dataset.fi) formSelect(+t.dataset.fi); });
$("bBody").addEventListener("toggle", (e) => { if (e.target.id === "bStamm" && e.target.open) sfFitAll(); }, true);
$("bBody").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches("textarea.sfin") && !e.target.matches("[data-fv]")) { e.preventDefault(); return; } if (e.target.id === "bInstr" && e.key === "Enter") { e.preventDefault(); bewKi("anweisung"); } });

// --- Claude ---
const BEW_SYSTEM = `Du hilfst Leonie Meier und Pascal Stadelmann (mit Sohn Lio) bei Wohnungsbewerbungen in Zürich-Wollishofen.
Du bearbeitest zwei Texte: das Anschreiben (PDF auf ihrer Vorlage) und die «Bemerkung»: ein kurzer Begleittext, mit dem sie das Dossier schicken – als Mail-Text (dazu ein kurzer Betreff) oder im Feld «Bemerkung» eines Online-Formulars.
Regeln:
- Deutsch in Schweizer Schreibweise (ss statt ß, «» als Anführungszeichen), «wir»-Form, Verwaltung wird gesiezt.
- Die Texte sollen nach Leonie und Pascal klingen, nicht nach KI: ihren Wortlaut und Satzbau so weit wie möglich behalten. Keine Floskeln, keine Superlative, keine Adjektivketten, keine Emojis.
- Nichts erfinden. Fakten nur aus den Stammdaten, dem Inserat oder den bestehenden Texten. Was nur die beiden wissen (z.B. was ihnen an der Besichtigung gefallen hat, Name der Ansprechperson), bleibt als Platzhalter in [eckigen Klammern] stehen. Nie einen eigenen, unsicheren Satz in Klammern stehen lassen: was du nicht sicher weisst, lässt du weg.
- Zuerst klären, wo sie stehen («stand» im Inserat):
  · Noch nicht besichtigt (Erstkontakt): Sie kennen die Wohnung nur vom Inserat. Also Interesse zeigen und um eine Besichtigung bitten, nicht mit der Tür ins Haus fallen: nie «wir möchten die Wohnung übernehmen/mieten», «wir bewerben uns für», «sie hat uns gefallen». Kurz (Bemerkung höchstens ca. 100 Wörter): wer wir sind, ein konkreter Grund aus dem Inserat, warum sie uns anspricht, Bitte um Besichtigung. Keine Platzhalter für Eindrücke. Schluss: «Über einen Besichtigungstermin würden wir uns sehr freuen.»
  · Besichtigt oder beworben: richtige Bewerbung wie in der Vorlage, Eindrücke der Besichtigung als [Platzhalter].
- Sucht die heutige Mieterin oder der heutige Mieter selbst einen Nachmieter (Privatperson statt Verwaltung): persönlicher und kürzer, keine Dossier-Details (Arbeitgeber genügt, kein Pensum, keine Vertragsdetails). Passt der Bezugstermin und ist in den Stammdaten nicht klar, ob sie dann einziehen können, einen Hinweis geben (nicht behaupten).
- Der Grosseltern-Grund (sie betreuen Lio in Luzern) gilt nur, wenn er für diese Lage stimmt: Wollishofen, Leimbach, Enge, Wiedikon, Friesenberg, Adliswil, Kilchberg und überhaupt Süden/Westen der Stadt sind näher Richtung Luzern als Schwamendingen. Liegt die Wohnung woanders (z.B. Zürichberg, Oerlikon, Altstetten Nord), den Grund weglassen, nicht umbiegen und keinen Platzhalter dafür.
- Alter aus den Geburtsdaten und dem heutigen Datum berechnen. Befristete oder endende Jobs nicht als dauerhaft darstellen (Datum beachten).
- Bei Genossenschaften das gemeinschaftliche Wohnen betonen, bei privaten Verwaltungen eher Verlässlichkeit und Stabilität.
- Die Anrede steht NICHT im Anschreiben-Text (sie wird separat gewählt). Absätze im Anschreiben durch eine Leerzeile trennen; der Schluss ist «Über eine positive Rückmeldung …», dann «Freundliche Grüsse» und in der nächsten Zeile «Leonie, Pascal und Lio».
- Hinweise: je genau ein kurzer Satz, mit «art»:
  · «klaeren»: höchstens 3, nur echte Stolpersteine, bei denen Leonie und Pascal etwas tun oder entscheiden müssen.
  · «idee»: höchstens 3 Vorschläge, die sie nutzen können oder nicht (anderes Detail aus dem Inserat, Frage für die Besichtigung).
  · «erklaerung»: höchstens 2, was du bewusst weggelassen oder geändert hast und warum.
  Nichts doppelt, keine Hinweise ohne Nutzen. Prüfe Widersprüche zwischen Anschreiben, Bemerkung, Stammdaten und Inserat, falsche oder veraltete Fakten, riskante oder missverständliche Sätze, Floskeln, Länge (das Anschreiben muss auf eine Seite passen: höchstens etwa 230 Wörter). «stelle» ist ein wörtliches, kurzes Zitat aus dem betroffenen Text (oder leer). Keine Hinweise auf offene [Platzhalter], die sind bekannt.
- Die gelernten Regeln stammen aus Änderungen, die Leonie und Pascal von Hand gemacht haben. Sie haben Vorrang vor allgemeinen Stilregeln.
- Nach-Check Textstil (Pascals Wunsch, immer bevor du antwortest): Lies jeden Satz, den du geschrieben oder geändert hast, so, als würden Leonie oder Pascal ihn laut sagen. Würden sie das so sagen? Typisch künstlich/KI: das Inserat nacherzählen («spricht uns an, dass …»), allgemeine Wertesätze («schätzen eine lebendige Nachbarschaft», «legen Wert auf …»), Dreierketten und Adjektivhäufungen, zu glatte, symmetrische Sätze, «besonders», «sehr gerne», «gegenseitig», Doppelpunkt-Effekte, Gedankenstriche als Stilmittel, Sätze, die für jede Familie und jede Wohnung passen würden. Solche Sätze ersetzt du durch einen einfachen, konkreten Satz oder streichst sie. Im Zweifel kürzer. Bei «Rechtschreibung prüfen» und «Stolpersteine» änderst du den Text nicht, sondern nennst künstlich wirkende Stellen als Hinweis.
- Antworte mit dem Werkzeug «bewerbung» (ausser der Auftrag nennt ein anderes).`;
const BEW_TOOL = { name: "bewerbung", description: "Ergebnis: beide Texte (vollständig) und Hinweise.",
  input_schema: { type: "object", required: ["anschreiben", "bemerkung", "hinweise"], properties: {
    anschreiben: { type: "string", description: "Vollständiger Anschreiben-Text ohne Anrede, Absätze durch Leerzeile getrennt" },
    bemerkung: { type: "string", description: "Vollständiger Begleittext (Mail-Text bzw. Bemerkung im Online-Formular, mit eigener Grusszeile am Anfang und Schluss)" },
    betreff: { type: "string", description: "Kurzer Mail-Betreff, z.B. «Bewerbung 3.5-Zimmer-Wohnung Thujastrasse 31»" },
    hinweise: { type: "array", items: { type: "object", required: ["text", "art"], properties: { art: { type: "string", enum: ["klaeren", "idee", "erklaerung"] }, stelle: { type: "string" }, text: { type: "string", description: "ein kurzer Satz" } } } } } } };
const BEW_AUFTRAG = {
  entwurf: `Erstelle beide Texte für diese Wohnung.
Anschreiben: Gehe vom Grundtext der Vorlage aus und behalte Aufbau, Wortwahl und Ton. Passe an: die Adresse im ersten Satz (richtige Präposition, z.B. «am Elfenweg», «an der Thujastrasse»), Fakten, die heute nicht mehr stimmen, Widersprüche zum Inserat und, wo es diese Wohnung verlangt, die Gewichtung (Genossenschaft: Nachbarschaft und Mitmachen; private Verwaltung: Verlässlichkeit, sicheres Einkommen, langfristig bleiben). Frage dich: Was will diese Verwaltung lesen, um uns zu nehmen – ohne zu übertreiben? Der Grund für den Umzug (Grosseltern in Luzern betreuen Lio, von Wollishofen viel näher) bleibt drin, wo er für die Lage stimmt (siehe Regeln). Nach einer Besichtigung [Platzhalter] für das, was ihnen gefallen hat, stehen lassen; vor der Besichtigung keine. Vor der Besichtigung ist der Schluss die Bitte um einen Besichtigungstermin statt «positive Rückmeldung». Falls das Inserat konkrete Merkmale nennt, schlage sie in einem Hinweis vor (nicht in den Text schreiben).
Bemerkung (Begleittext): Gehe von der Vorlage-Bemerkung aus und passe sie an dieses Inserat an (Zimmerzahl, Strasse, Genossenschaft oder private Verwaltung). Sie muss als Mail-Text funktionieren, mit dem das Dossier geschickt wird («Im Anhang finden Sie unser Dossier …»), und ebenso im Bemerkungsfeld eines Formulars. Den Satz zur Belegung nur, wenn das Inserat die Personenzahl begrenzt. Kurz halten. Dazu ein kurzer «betreff».`,
  pruefung: (feld) => `Prüfe nur den Text «${feld === "text" ? "Anschreiben" : "Bemerkung (Begleit-Mail / Bemerkung im Online-Formular)"}». Leonie oder Pascal haben ihn eben bearbeitet. Achte auch auf Widersprüche zum anderen Text. ${PRUEF_REGELN}`,
};
function bewInserat(k = BEW.k, x0 = BEW.x, d0 = BEW.d) {
  const x = x0 || {}, d = d0 || {}, f = d.facts || {};
  const desc = (d.description || x.text || "").replace(/\*\*/g, "").slice(0, 5000);
  return JSON.stringify({ titel: d.title || x.title, strasse: x.street, plz: x.plz, ort: x.city, zimmer: x.rooms, miete_brutto: x.rent || f.rent_gross,
    flaeche_m2: x.m2 || f.livingspace, bezug: f.moving_date || x.moving_date, verwaltung: d.agency?.name || x.agency, portal: x.portal,
    merkmale: d.attributes, einschaetzung_claude: x.ai?.text, haken: x.ai?.haken, beschreibung: desc, eigene_notiz: itemOf(k).note || undefined,
    stand: ({ besichtigung: "Besichtigung vereinbart oder gemacht", beworben: "schon beworben", angefragt: "angefragt, noch nicht besichtigt" })[itemOf(k).status?.value] || "noch nicht besichtigt (Erstkontakt)" }, null, 1);
}
async function claudeCall(mode, feld) {
  const c = BEW.ctx, doc = bewRead();
  const user = `Heute ist ${new Date().toLocaleDateString("de-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.

<stammdaten>
${JSON.stringify(c.stamm, null, 1)}
</stammdaten>

<stil_und_fruehere_texte>
${c.stil}
</stil_und_fruehere_texte>

<gelernte_regeln>
${(c.regeln || []).map((r) => "- " + r.regel).join("\n") || "(noch keine)"}
</gelernte_regeln>

<fertige_anschreiben_als_stilbeispiel>
${(c.fertige || []).filter((f) => f.adresse !== doc.adresse).slice(0, 3).map((f) => `[${f.adresse}]\n${f.text}`).join("\n\n") || "(noch keine)"}
</fertige_anschreiben_als_stilbeispiel>

<vorlage_anschreiben>
${c.vorlage.text}
</vorlage_anschreiben>

<vorlage_bemerkung>
${c.vorlage.bemerkung}
</vorlage_bemerkung>

<inserat>
${bewInserat()}
</inserat>

<aktuell>
Adresse: ${doc.adresse}
Anrede: ${anredeZeile(doc.anrede, doc.name)}
--- Anschreiben ---
${doc.text}
--- Bemerkung (Begleittext) ---
${doc.betreff ? `Betreff: ${doc.betreff}\n` : ""}${doc.bemerkung || "(noch leer)"}
</aktuell>

<auftrag>
${typeof BEW_AUFTRAG[mode] === "function" ? BEW_AUFTRAG[mode](feld) : BEW_AUFTRAG[mode]}
</auftrag>`;
  return mode === "pruefung" ? claudeTool(BEW_SYSTEM, user, PRUEF_TOOL, "vorschlaege") : claudeTool(BEW_SYSTEM, user, BEW_TOOL, "anschreiben");
}
async function claudeTool(system, user, tool, need, textAs) {
  const call = (messages) => fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "content-type": "application/json", "x-api-key": BEW.ctx.key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: S.config?.ai?.model || "claude-opus-5-5", max_tokens: 6000, system, tools: [tool],
      tool_choice: { type: "auto" }, messages }) });
  // Opus 5.5 erlaubt kein erzwungenes Werkzeug → Antwort auswerten; ohne Werkzeug einmal nachfragen (15.11.: «Prüfen» antwortete nur mit Text)
  const parse = (j) => {
    const tu = (j.content || []).find((b) => b.type === "tool_use");
    if (tu?.input?.[need] != null) return tu.input;
    if (tu?.input && tool.input_schema?.properties?.[need]?.type === "array") return { ...tu.input, [need]: [] };   // leere Liste weggelassen
    const t = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = t.match(/\{[\s\S]*\}/); if (m) { try { const o = JSON.parse(m[0]); if (o[need] != null) return o; } catch { } }
    return { _text: t.trim(), _tool: !!tu };
  };
  const messages = [{ role: "user", content: user }];
  for (let i = 0; i < 2; i++) {
    const r = await call(messages);
    let j = {}; try { j = await r.json(); } catch { }
    if (!r.ok) throw new Error(r.status === 401 ? "Der Claude-Schlüssel ist ungültig." : j?.error?.message || `Claude meldet Fehler ${r.status}.`);
    const res = parse(j);
    if (!("_text" in res)) return res;
    if (textAs && res._text) return { [textAs]: res._text };     // Chat: Text ist eine gültige Antwort
    if (i || res._tool || !res._text) { console.warn("claudeTool: unerwartete Antwort", j); break; }
    messages.push({ role: "assistant", content: res._text }, { role: "user", content: `Bitte gib das Ergebnis jetzt ausschliesslich mit dem Werkzeug «${tool.name}» zurück, ohne weiteren Text.` });
  }
  throw new Error("Claude hat nicht im erwarteten Format geantwortet.");
}
// «✦ Entwurf für diese Wohnung»: beide Texte neu, Hinweise, Diff mit «Rückgängig» (einziger Modus seit v97; Prüfen = bpCheck, Änderungen = Chat)
async function bewKi() {
  if (BEW.busy) return;
  if (!BEW.ctx.key) { toast("Zuerst den Claude-Schlüssel hinterlegen (Mehr).", "err"); return; }
  BEW.busy = true; document.querySelectorAll("#bClaude [data-ki]").forEach((b) => (b.disabled = true));
  $("bState").textContent = "Claude schreibt den Entwurf … (ca. 20–40 Sek.)";
  const before = { text: bewRead().text, bemerkung: BEW.doc.bemerkung };
  bewLearnMaybe();
  try {
    const res = await claudeCall("entwurf");
    const text = String(res.anschreiben || "").replace(/\r/g, "").trim(), note = String(res.bemerkung || "").replace(/\r/g, "").trim();
    if (text) $("bText").value = text;
    if (note) $("bNote").value = note;
    if (res.betreff && $("bBetreff")) $("bBetreff").value = String(res.betreff).trim();
    BEW.doc.hinweise = (res.hinweise || []).filter((h) => h && h.text).slice(0, 8);
    bewRead(); bewCount();
    const changed = before.text !== BEW.doc.text || before.bemerkung !== BEW.doc.bemerkung;
    BEW.prev = changed ? before : null;
    bewTips(); bewDiff(before); bpRenderText("text"); bpRenderText("bemerkung"); bpStatus();
    $("bState").textContent = changed ? "Fertig. Änderungen sind unten markiert." : "Fertig.";
    BEW.doc.ki = { text: BEW.doc.text, bemerkung: BEW.doc.bemerkung || "", at: new Date().toISOString() };
    bewMark();
    const nt = (BEW.doc.hinweise || []).length;
    toast(changed ? "Geändert – unten markiert" : nt ? `${nt} Hinweis${nt > 1 ? "e" : ""}` : "Fertig", "ok");
    const tgt = changed ? $("bDiff") : nt ? $("bTips") : null;
    if (tgt && tgt.innerHTML.trim()) { tgt.scrollIntoView({ behavior: "smooth", block: "center" }); tgt.classList.add("act-flash"); setTimeout(() => tgt.classList.remove("act-flash"), 1700); }
  } catch (e) { $("bState").textContent = "Fehler: " + e.message; toast("Claude: " + e.message, "err", 7000); }
  finally { BEW.busy = false; document.querySelectorAll("#bClaude [data-ki]").forEach((b) => (b.disabled = false)); }
}
// Hinweise nach Art: «Zu klären» sichtbar, Ideen eingeklappt, Erklärungen als Zeile bei den Änderungen
const tipArt = (t) => (["klaeren", "idee", "erklaerung"].includes(t.art) ? t.art : "klaeren");
const tipRow = (t, cls) => `<div class="${cls} bp-k"><span${t.stelle ? ` data-stelle="${esc(t.stelle)}" role="button" tabindex="0"` : ""}>${esc(t.text)}${t.stelle ? ' <span class="tipgo" aria-hidden="true">›</span>' : ""}</span><button type="button" class="linkbtn" data-tipdone="${esc(t.text.slice(0, 60))}">Erledigt</button></div>`;
const bewErkl = () => (BEW.doc.hinweise || []).filter((t) => tipArt(t) === "erklaerung").slice(0, 2);
function bewTips() {
  const h = BEW.doc.hinweise || [], k = h.filter((t) => tipArt(t) === "klaeren").slice(0, 3), id = h.filter((t) => tipArt(t) === "idee").slice(0, 3);
  const er = BEW.prev ? [] : bewErkl();      // ohne Änderungen: Erklärungen hier, sonst bei «Was Claude geändert hat»
  $("bTips").innerHTML = (k.length ? `<div class="ftitle sm">Zu klären</div>${k.map((t) => tipRow(t, "tip")).join("")}` : "")
    + (id.length ? `<details class="ideas"><summary>${id.length} ${id.length === 1 ? "Idee" : "Ideen"} von Claude</summary>${id.map((t) => tipRow(t, "idea")).join("")}</details>` : "")
    + (er.length ? `<p class="hint erkl">${er.map((t) => esc(t.text)).join(" ")}</p>` : "");
}
function bewShow(q) {
  for (const [id, feld] of [["bText", "text"], ["bNote", "bemerkung"]]) {
    const el = $(id), i = el.value.indexOf(q);
    if (i < 0) continue;
    if (!BEW.edit?.has(feld)) { bpToggle(feld === "text" ? "anschreiben" : "begleit", true); bpEdit(feld, true); }
    setTimeout(() => { el.focus(); el.setSelectionRange(i, i + q.length); el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 60); return;
  }
  toast("Stelle nicht mehr gefunden.", "");
}
function wdiff(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/), n = A.length, m = B.length;
  if (n * m > 2.5e6) return esc(b);
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = "";
  while (i < n && j < m) {
    if (A[i] === B[j]) { out += esc(A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out += `<del>${esc(A[i++])}</del>`; }
    else { out += `<ins>${esc(B[j++])}</ins>`; }
  }
  while (i < n) out += `<del>${esc(A[i++])}</del>`;
  while (j < m) out += `<ins>${esc(B[j++])}</ins>`;
  return out;
}
function bewDiff(before) {
  if (!BEW.prev) { $("bDiff").innerHTML = ""; return; }
  const part = (t, a, b) => a === b ? "" : `<div class="ftitle sm">${t}</div><div class="diff">${wdiff(a, b)}</div>`;
  $("bDiff").innerHTML = `<div class="ftitle sm">Was Claude geändert hat</div>
    ${part("Anschreiben", before.text, BEW.doc.text)}${part("Bemerkung", before.bemerkung || "", BEW.doc.bemerkung)}
    ${bewErkl().length ? `<p class="hint erkl">${bewErkl().map((t) => esc(t.text)).join(" ")}</p>` : ""}
    <div class="brow"><button type="button" class="btn" id="bUndo">Rückgängig</button></div>`;
}
function bewUndo() {
  if (!BEW.prev) return;
  $("bText").value = BEW.prev.text; $("bNote").value = BEW.prev.bemerkung || "";
  BEW.prev = null; bewRead(); bewCount(); $("bDiff").innerHTML = ""; $("bState").textContent = "Rückgängig gemacht."; bpRenderText("text"); bpRenderText("bemerkung"); bpStatus();
  BEW.doc.ki = { text: BEW.doc.text, bemerkung: BEW.doc.bemerkung || "", at: new Date().toISOString() };
  bewMark();
}

// Regelvorschläge aus allgemeinen Kommentaren (Kontakt-Nachricht)
