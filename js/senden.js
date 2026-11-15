"use strict";
// --- Verschicken & Dateien (v91, Pascal 15.11.: «nicht nur senden, auch Dateien einzeln, ganzes Dossier … möglichst individuell») ---
// Wollihood verschickt nie selbst: Mail-App (Teilen mit Anhängen bzw. mailto), Plattform/Portal öffnen, Dateien laden.
const WEGE = [["mail", "Per Mail"], ["plattform", "Online-Plattform"], ["portal", "Portal / Flatfox"], ["papier", "Ausdrucken"]];
function sendContact() {
  const x = BEW.x || {}, d = BEW.d || {}, ag = d.agency || (x.agency ? { name: x.agency } : null);
  const book = ag ? (S.agencies[agencyKey(ag.name)] || {}) : {};
  const ksh = shotOk(BEW.k)?.kontakt || x.contact_shots || {};
  return { mail: book.email || (d.contacts?.emails || [])[0] || ksh.mail || "", apply: d.apply_url || "", url: typeof goodUrl === "function" ? goodUrl(x) : (x.url || "") };
}
function sendWegVorschlag() {
  const c = sendContact(), x = BEW.x || {}, txt = ((BEW.d?.description || "") + " " + (x.text || "")).toLowerCase();
  if (/per (e-?)?mail|an (die )?folgende (e-?)?mail|unterlagen[^.]{0,60}(an|per) [\w.-]+@/.test(txt) || (c.mail && !c.apply)) return ["mail", c.mail ? "Mail-Adresse der Verwaltung bekannt" : "Inserat verlangt Unterlagen per Mail"];
  if (c.apply || /bewerbungsformular|online[- ]?(bewerb|formular|anmeld)|plattform|emeria|wohnungsbewerbung\.ch/.test(txt)) return ["plattform", c.apply ? "Inserat hat einen Bewerbungslink" : "Inserat nennt ein Online-Formular"];
  if (/flatfox/.test(txt) || String(BEW.k).startsWith("flatfox:")) return ["portal", "Inserat auf Flatfox"];
  return ["mail", "im Inserat steht nichts anderes"];
}
function sendSelected() { return dossierItems().filter(dossierOn); }
function renderSend() {
  const el = $("bSendBody"); if (!el) return;
  { const cp = $("bCopy"), home = $("bCopyHome"); if (cp && home && cp.parentElement !== home) home.appendChild(cp); }   // vor dem Neuzeichnen heimholen
  const [vor, warum] = sendWegVorschlag(), weg = BEW.doc.weg || vor, c = sendContact(), doc = BEW.doc;
  const sel = sendSelected(), alt = sel.filter((b) => baustAlter(b)?.alt).length;
  const betreff = doc.betreff || bpBetreffVor();
  const wegBox = {
    mail: `<label class="f"><small>An</small><input class="field" id="sTo" type="email" value="${esc(doc.an ?? c.mail)}" placeholder="vermietung@…"></label>
      <p class="hint">Betreff: ${esc(betreff)} · Text: Begleit-Mail ${(doc.bemerkung || "").trim() ? "✓" : "<b>noch leer</b>"}</p>
      <div class="seg sm" role="group" aria-label="Anhänge"><button type="button" class="opt" data-sanh="ein" aria-pressed="${(doc.anhang || "ein") === "ein"}">Ein PDF</button><button type="button" class="opt" data-sanh="einzeln" aria-pressed="${doc.anhang === "einzeln"}">Einzelne Dateien</button></div>
      <button type="button" class="btn primary" id="sMail">Mail mit Anhängen vorbereiten</button>
      <p class="hint">Öffnet «Teilen» → eure Mail-App wählen. Ihr schickt selbst, von eurer Adresse. Empfänger und Betreff setzt ihr dort ein: <button type="button" class="linkbtn" id="sCopyTo">Adresse kopieren</button> · <button type="button" class="linkbtn" id="sCopySub">Betreff kopieren</button></p>
      <a class="linkbtn" id="sMailto" href="#">Nur Text in der Mail-App (ohne Anhänge)</a>`,
    plattform: `${c.apply || c.url ? `<a class="btn primary" href="${esc(c.apply || c.url)}" target="_blank" rel="noopener">${c.apply ? "Bewerbungs-Plattform öffnen ↗" : "Inserat öffnen ↗"}</a>` : ""}
      <p class="hint">Dort die Dateien einzeln hochladen (unten ⬇) und die Angaben hineinkopieren.</p>
      <button type="button" class="btn sm" id="sCopyNote">Begleittext kopieren</button>
      <div id="sCopySlot"></div>`,
    portal: `${c.url ? `<a class="btn primary" href="${esc(c.url)}" target="_blank" rel="noopener">Inserat öffnen ↗</a>` : ""}
      <p class="hint">Im Portal den Begleittext ins Nachrichtenfeld und das Dossier als ein PDF anhängen.</p>
      <div class="kbar"><button type="button" class="btn sm" id="sCopyNote">Begleittext kopieren</button><button type="button" class="btn sm" id="sShareOne">Dossier-PDF teilen</button></div>`,
    papier: `<p class="hint">Dossier als ein PDF öffnen und drucken (oder im Copyshop).</p><button type="button" class="btn primary" id="sOpenOne">Dossier-PDF öffnen</button>`,
  }[weg];
  el.innerHTML = `<div class="seg wrap" role="group" aria-label="Wie verschickt ihr?">${WEGE.map(([w, l]) => `<button type="button" class="opt" data-sweg="${w}" aria-pressed="${w === weg}">${l}${w === vor ? " ✦" : ""}</button>`).join("")}</div>
    <p class="hint">✦ Vorschlag: ${esc(warum)}. Jede Verwaltung ist anders – wählt, was das Inserat verlangt.</p>
    <div class="s-weg">${wegBox}</div>
    <div class="s-files"><div class="ftitle sm">Dateien (${sel.length} ausgewählt${alt ? ` · <span class="warnline">${alt} zu alt</span>` : ""})</div>
      ${dossierItems().map((b) => `<div class="drow"><label><input type="checkbox" data-dsel="${esc(b.id)}"${dossierOn(b) ? " checked" : ""}><span>${esc(b.titel)}</span></label><button type="button" class="iconbtn" data-dl="${esc(b.id)}" aria-label="${esc(b.titel)} herunterladen">⬇</button></div>`).join("")}
      <div class="kbar"><button type="button" class="btn sm" id="bDossierPdf">⬇ Dossier als ein PDF</button><button type="button" class="btn sm" id="sAllDl">⬇ Ausgewählte einzeln</button><button type="button" class="btn sm" id="sShareSel">Ausgewählte teilen …</button></div>
      <div id="bDossierLink"></div>
      <p class="hint">Reihenfolge und weitere Dokumente unter «Unterlagen».</p></div>`;
  if (weg === "plattform") { const cp = $("bCopy"); if (cp) $("sCopySlot").appendChild(cp); }
}
// Dateien für den Versand bauen
async function sendFiles(mode) {
  bewRead(); await pdfAssets();
  const sel = sendSelected(); if (!sel.length) throw new Error("Keine Datei ausgewählt.");
  const alt = sel.filter((b) => baustAlter(b)?.alt).map((b) => b.titel);
  if (alt.length && !confirm(`Zu alt: ${alt.join(", ")}\n\nTrotzdem verwenden?`)) return null;
  const offen = (BEW.doc.text + " " + BEW.doc.name).match(/\[[^\]]*\]/g);
  if (sel.some((b) => b.id === "anschreiben") && offen && !confirm(`Im Anschreiben noch offen: ${offen.join(", ")}\n\nTrotzdem?`)) return null;
  if (sel.some((b) => b.id === "anschreiben")) bewPdfStore().catch(() => { });   // Anschreiben.pdf sichern + «fertige Texte» lernen
  if (mode === "ein") {
    const bytes = await dossierBytes();
    return [new File([bytes], `Bewerbungsdossier_${fileSlug(BEW.x.street || "Wohnung")}.pdf`, { type: "application/pdf" })];
  }
  const out = [];
  for (const [i, b] of sel.entries()) { const { bytes, type } = await itemBytes(b); out.push(new File([bytes], `${String(i + 1).padStart(2, "0")}_${itemName(b, type)}`, { type })); }
  return out;
}
async function sendShare(mode, withText) {
  const files = await sendFiles(mode); if (!files) return;
  const doc = BEW.doc, data = { files };
  if (withText) { data.title = doc.betreff || bpBetreffVor(); data.text = doc.bemerkung || ""; }
  const mb = files.reduce((s, f) => s + f.size, 0) / 1048576;
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share(data); toast(`Geteilt (${mb.toFixed(1)} MB)`, "ok"); sendDone(); }
    catch (e) { if (e.name !== "AbortError") throw e; toast("Abgebrochen", ""); }
    return;
  }
  // Computer ohne Teilen: Dateien laden, Mail-App mit Text öffnen
  files.forEach((f) => saveBlob(f, f.type, f.name));
  if (withText) location.href = sendMailto();
  toast(withText ? "Dateien heruntergeladen – in der Mail anhängen." : "Heruntergeladen.", "ok", 6000);
  if (withText) sendDone();
}
function sendMailto() {
  const doc = BEW.doc, to = ($("sTo")?.value || doc.an || sendContact().mail || "").trim();
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(doc.betreff || bpBetreffVor())}&body=${encodeURIComponent(doc.bemerkung || "")}`;
}
function sendDone() {
  if (stepsOf(BEW.k).bewerbung) return;
  setTimeout(() => toastAction("Verschickt? Dann als beworben markieren.", "Beworben", () => setStep(BEW.k, "bewerbung", { weg: BEW.doc.weg || sendWegVorschlag()[0] }), 12000), 1500);
}
async function copyText(t, what) { try { await navigator.clipboard.writeText(t); toast(what + " kopiert.", "ok"); } catch { toast("Kopieren nicht möglich.", "err"); } }
$("bBody").addEventListener("click", async (e) => {
  const t = e.target, w = t.closest("[data-sweg]");
  if (w) { BEW.doc.weg = w.dataset.sweg; renderSend(); bewMark(); return; }
  const an = t.closest("[data-sanh]"); if (an) { BEW.doc.anhang = an.dataset.sanh; renderSend(); bewMark(); return; }
  try {
    if (t.id === "sMail") { if (!(BEW.doc.bemerkung || "").trim() && !confirm("Die Begleit-Mail ist noch leer. Trotzdem?")) return; await sendShare(BEW.doc.anhang || "ein", true); return; }
    if (t.id === "sMailto") { e.preventDefault(); location.href = sendMailto(); sendDone(); return; }
    if (t.id === "sCopyTo") return copyText(($("sTo")?.value || "").trim(), "Adresse");
    if (t.id === "sCopySub") return copyText(BEW.doc.betreff || bpBetreffVor(), "Betreff");
    if (t.id === "sCopyNote") {
      const v = BEW.doc.bemerkung || ""; const offen = v.match(/\[[^\]]*\]/g);
      if (offen && !confirm(`Im Begleittext steht noch: ${offen.join(", ")}\n\nTrotzdem kopieren?`)) return;
      return copyText(v, "Begleittext");
    }
    if (t.id === "sShareOne") return sendShare("ein", false);
    if (t.id === "sShareSel") return sendShare("einzeln", false);
    if (t.id === "sOpenOne") { const f = await sendFiles("ein"); if (f) { const u = URL.createObjectURL(f[0]); window.open(u, "_blank") || saveBlob(f[0], f[0].type, f[0].name); } return; }
    if (t.id === "sAllDl") { const f = await sendFiles("einzeln"); if (f) { for (const x of f) { saveBlob(x, x.type, x.name); await new Promise((r) => setTimeout(r, 400)); } toast(`${f.length} Dateien heruntergeladen.`, "ok"); } return; }
  } catch (err) { toast("Nicht möglich: " + err.message, "err", 7000); }
});
$("bBody").addEventListener("change", (e) => { if (e.target.id === "sTo") { BEW.doc.an = e.target.value.trim(); bewMark(); } });

function renderCopy() {
  const el = $("bCopyBody"); if (!el) return;
  BEW.copy = copyRows();
  el.innerHTML = BEW.copy.map(([k, v], i) => k === "h" ? `<div class="sfhead">${esc(v)}</div>`
    : `<div class="crow"><span>${esc(k)}</span><b>${esc(v)}</b><button type="button" class="iconbtn" data-copy="${i}" aria-label="${esc(k)} kopieren">⧉</button></div>`).join("");
}

// --- Optionen: Claude-Schlüssel (liegt im privaten Repo, gilt für beide) ---
async function kiState() {
  try { const r = await readJson("dossier/ki.json"); S.kiSha = r.sha;
    $("kiState").textContent = r.data.anthropic_key ? `Hinterlegt${r.data.by ? " von " + (PEOPLE[r.data.by] || r.data.by) : ""}, ${ago(r.data.at)}. Gilt für euch beide.` : "Noch kein Schlüssel hinterlegt.";
  } catch (e) { S.kiSha = null; $("kiState").textContent = e.status === 404 ? "Noch kein Schlüssel hinterlegt." : "Status nicht ladbar: " + e.message; }
}
$("kiSave").addEventListener("click", async () => {
  const key = $("kiKey").value.trim();
  if (!/^sk-ant-/.test(key)) { toast("Das sieht nicht wie ein Claude-Schlüssel aus (beginnt mit sk-ant-).", "err"); return; }
  $("kiSave").disabled = true;
  try {
    const t = await fetch("https://api.anthropic.com/v1/models", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    if (!t.ok) throw new Error(t.status === 401 ? "Claude lehnt den Schlüssel ab." : `Prüfung fehlgeschlagen (${t.status}).`);
    S.kiSha = await writeJson("dossier/ki.json", { anthropic_key: key, by: S.person, at: new Date().toISOString() }, S.kiSha, "Claude-Schlüssel für Bewerbungen");
    $("kiKey").value = ""; BEW.ctx = null; toast("Schlüssel gespeichert.", "ok"); kiState();
  } catch (e) { toast(e.message, "err"); }
  finally { $("kiSave").disabled = false; }
});
if (S.token) setTimeout(() => { kiState(); lernLoad(); baustRender(); renderKosten(); }, 1200);
