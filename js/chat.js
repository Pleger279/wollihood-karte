"use strict";
// --- Chat pro Wohnung (v92, Pascal 14./15.11.: «einmal pro Wohnung, nicht für jeden Bestandteil») ---
// Unten am Schritt-Panel, in jedem Tab sichtbar. Claude beantwortet Fragen und ändert auf Wunsch Kontakt-Nachricht,
// Anschreiben, Begleit-Mail oder Betreff (ganzer neuer Text je Feld → Diff + «Rückgängig» pro Antwort). Gespeichert in
// archiv/<id>/bewerbung/chat.json (gilt für beide). Ersetzt die Änderungswünsche (kmt).
const CH = { k: null, sha: null, msgs: [], busy: false, all: false };
const CH_FELD = { kontakt: "Kontakt-Nachricht", text: "Anschreiben", bemerkung: "Begleit-Mail", betreff: "Mail-Betreff" };
const CHAT_TOOL = { name: "chat", description: "Antwort im Chat zu dieser Wohnung, optional mit geänderten Texten.",
  input_schema: { type: "object", required: ["antwort"], properties: {
    antwort: { type: "string", description: "Kurze Antwort an Leonie/Pascal (du-Form, Schweizer Schreibweise). Bei Änderungen: in einem Satz, was du geändert hast." },
    aenderungen: { type: "array", description: "Nur wenn sie eine Änderung oder einen neuen Text wollen: je Feld der vollständige neue Text",
      items: { type: "object", required: ["feld", "neu"], properties: { feld: { type: "string", enum: ["kontakt", "text", "bemerkung", "betreff"] }, neu: { type: "string" } } } },
    angaben: { type: "object", description: "Nur wenn sie Angaben der Wohnung korrigieren oder ergänzen (z.B. Hausnummer, Miete): nur die geänderten Felder",
      properties: { strasse: { type: "string", description: "Strasse mit Hausnummer" }, plz: { type: "string" }, ort: { type: "string" }, zimmer: { type: "number" },
        miete_brutto: { type: "number" }, flaeche_m2: { type: "number" }, etage: { type: "string" }, bezug: { type: "string" }, befristung: { type: "string" } } },
    weg: { type: "string", enum: ["mail", "plattform", "portal", "papier"], description: "Nur wenn sie sagen, wie die Bewerbung eingereicht wird" },
    kontakt: { type: "object", description: "Nur wenn sie Kontakt der Verwaltung/Vermieter nennen: nur genannte Felder",
      properties: { firma: { type: "string" }, name: { type: "string" }, telefon: { type: "string" }, mail: { type: "string" } } },
    stand: { type: "object", description: "Nur wenn sie einen Schritt melden: schritt = kontakt (angefragt) | besichtigung | bewerbung (beworben) | zusage | absage; termin = ISO-Datum/Zeit der Besichtigung (Europe/Zurich), falls genannt",
      properties: { schritt: { type: "string", enum: ["kontakt", "besichtigung", "bewerbung", "zusage", "absage"] }, termin: { type: "string" }, besichtigt: { type: "boolean" } } },
    notiz: { type: "string", description: "Nur wenn sie etwas notieren wollen oder eine nützliche Info nennen, die nirgends sonst passt: eine kurze Zeile für die Notiz" },
    regel_vorschlaege: { type: "array", description: "Nur wenn ein Wunsch allgemein für künftige Texte gilt", items: { type: "object", required: ["regel"], properties: { regel: { type: "string" }, beispiel: { type: "string" } } } } } } };
const CH_EXTRA = { angaben: "Angaben der Wohnung", weg: "Versandweg", kontakt_vw: "Kontakt der Verwaltung", stand: "Stand", notiz: "Notiz" };
const ANG_LABEL = { strasse: "Strasse", plz: "PLZ", ort: "Ort", zimmer: "Zimmer", miete_brutto: "Miete brutto", flaeche_m2: "Fläche m²", etage: "Etage", bezug: "Bezug", befristung: "Befristung" };
const angText = (a) => Object.entries(a || {}).filter(([, v]) => v !== "" && v != null).map(([f, v]) => `${ANG_LABEL[f] || f}: ${v}`).join("\n");
function angCurrent(k) {
  const x = hitByKey(k) || {};
  return { strasse: x.street || "", plz: x.plz || "", ort: x.city || "", zimmer: x.rooms ?? "", miete_brutto: x.rent ?? "", flaeche_m2: x.m2 ?? "", etage: x.floor_text || "", bezug: x.moving_date_text || "", befristung: x.limited_text || "" };
}
// Angaben korrigieren = wie bestätigte Screenshot-Angaben (social.shots, status ok) → App sofort, Suchskript (shots.py) verortet neu
function chatSetAngaben(k, neu, prevShots) {
  const now = new Date().toISOString();
  socialOp(`${PEOPLE[S.person]}: Angaben im Chat korrigiert`, (items) => {
    const it = items[k] || (items[k] = { votes: {} });
    if (prevShots !== undefined) { if (prevShots) it.shots = prevShots; else delete it.shots; }
    else { const sh = it.shots?.status === "ok" ? it.shots : {}; it.shots = { ...sh, status: "ok", angaben: { ...(sh.angaben || {}), ...neu }, by: S.person, at: now, quelle: "chat" }; }
    it.updated = now;
  });
  const x = hitByKey(k);
  if (x) { if (prevShots === undefined) shotOverlay(x); else Object.assign(x, Object.fromEntries(Object.entries(neu).map(([f, v]) => [SHOT_PREV[f], v]).filter(([d]) => d))); }
  setTimeout(() => { refreshDetail(); renderHits(); }, 80);
}
function chatSocial(k, label, fn) {
  socialOp(`${PEOPLE[S.person]}: ${label} (Chat)`, (items) => { const it = items[k] || (items[k] = { votes: {} }); fn(it); it.updated = new Date().toISOString(); });
  setTimeout(() => { refreshDetail(); renderHits(); }, 80);
}
function chatSetSteps(k, steps) {
  chatSocial(k, "Stand", (it) => {
    it.steps = steps || {}; const ns = statusFrom(it.steps);
    if (!ns) delete it.status; else it.status = { ...ns, when: ns.when || null, by: S.person, at: new Date().toISOString() };
  });
}
const stepsText = (st) => STEPS.filter(([n]) => n === "besichtigung" ? st.besichtigung && (st.besichtigung.when || st.besichtigung.done) : st[n])
  .map(([n, l]) => n === "antwort" ? (st.antwort.value === "zusage" ? "Zusage" : "Absage") : n === "besichtigung" && st.besichtigung.when ? `${l} ${new Date(st.besichtigung.when).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" })}` : l).join(" → ") || "(nichts)";
// v105 (Pascal 17.11.): Chat nicht mehr mitten auf der Wohnungsseite, sondern schwebender Knopf ✦ → Fenster von unten.
// Die Elemente stehen fest in index.html (#chSheet) und überleben so jedes Neuzeichnen der Wohnungsseite.
function chatOpen() {
  if (!$("chSheet").hidden) return;
  $("chSheet").hidden = false; $("chBack").hidden = false; $("chFab").hidden = true;
  history.pushState({ chat: 1 }, "");
  chatRender(); chatKb();
  const sc = $("chScroll"); sc.scrollTop = sc.scrollHeight;
}
function chatHide() {
  if ($("chSheet").hidden) return;
  $("chSheet").hidden = true; $("chBack").hidden = true; $("chFab").hidden = false; $("chSheet").style.transform = "";
  $("chIn").blur();
}
function chatClose() { if ($("chSheet").hidden) return; if (history.state?.chat) history.back(); else chatHide(); }
window.addEventListener("popstate", () => { if (!history.state?.chat) chatHide(); });
// Tastatur am Handy: Fenster bleibt über der Tastatur
function chatKb() {
  const vv = window.visualViewport; if (!vv) return;
  $("chSheet").style.setProperty("--kb", Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px");
}
window.visualViewport?.addEventListener("resize", chatKb);
$("chFab").addEventListener("click", chatOpen);
$("chClose").addEventListener("click", chatClose);
$("chBack").addEventListener("click", chatClose);
// Nach unten wischen schliesst (am Griff oben)
(() => {
  let y0 = null, dy = 0; const sh = $("chSheet"), g = $("chGrip");
  g.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; y0 = e.clientY; dy = 0; g.setPointerCapture?.(e.pointerId); sh.style.transition = "none"; });
  g.addEventListener("pointermove", (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = dy ? `translateY(${dy}px)` : ""; });
  const up = () => { if (y0 == null) return; y0 = null; sh.style.transition = ""; sh.style.transform = ""; if (dy > 80) chatClose(); };
  g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
})();
async function chatLoad(k) {
  if (CH.k !== k) {
    CH.k = k; CH.sha = null; CH.msgs = []; CH.all = false; CH.live = false; chatRender();
    try { const r = await readJson(`archiv/${await aidOf(k)}/bewerbung/chat.json`); if (CH.k !== k) return; CH.msgs = r.data.msgs || []; CH.sha = r.sha; } catch { }
  }
  chatRender();
}
function chatRender() {
  const el = $("chList"); if (!el) return;
  const list = CH.k === S.detailKey ? CH.msgs : [];
  $("chFabDot").hidden = !list.length;
  $("chFab").setAttribute("aria-label", list.length ? `Chat mit Claude öffnen (${list.length} Nachrichten)` : "Chat mit Claude öffnen");
  if (CH.k !== S.detailKey) { el.innerHTML = '<p class="hint">Lade …</p>'; return; }
  el.innerHTML = (list.length ? "" : `<p class="hint">Fragen zur Wohnung, Texte ändern, Angaben korrigieren, Termin oder Stand melden – z.B. «Besichtigung am Do 18 Uhr» oder «Adresse ist Scheideggstrasse 104». Gilt für euch beide.</p>`)
    + list.map((m, i) => {
      if (m.role === "user") return `<div class="ch-msg me"><small>${esc(PEOPLE[m.by] || m.by || "")} · ${esc(ago(m.at))}</small><p>${esc(m.text)}</p></div>`;
      const ch = (m.changes || []).map((c) => `<details class="ch-chg"><summary>${m.undone ? "↶ zurückgenommen: " : "✎ "}${esc(CH_FELD[c.feld] || CH_EXTRA[c.feld] || c.feld)}</summary><div class="diff">${wdiff(c.alt || "", c.neu || "")}</div></details>`).join("");
      return `<div class="ch-msg ki${m.error ? " err" : ""}"><small>✦ Claude · ${esc(ago(m.at))}</small><p>${esc(m.text)}</p>${ch}${(m.changes || []).length && !m.undone ? `<button type="button" class="linkbtn" data-chundo="${i}">Rückgängig</button>` : ""}</div>`;
    }).join("")
    + (CH.busy ? `<div class="ch-msg ki"><small>✦ Claude</small><p class="hint">schreibt …</p></div>` : "");
}
async function chatSave() {
  const aid = await aidOf(CH.k);
  CH.sha = await writeJson(`archiv/${aid}/bewerbung/chat.json`, { msgs: CH.msgs.slice(-80) }, CH.sha, `Chat (${PEOPLE[S.person] || ""})`);
}
async function chatEnsureTexts(k) {
  if (BEW.k !== k || !BEW.doc) await bewLoad(k);
  if (KON.k !== k) { KON.k = k; KON.sha = null; KON.data = null; try { const r = await readJson(`archiv/${await aidOf(k)}/bewerbung/kontakt.json`); KON.data = r.data; KON.sha = r.sha; } catch { } }
}
async function chatSetFields(k, map) {          // map: feld → neuer Text; speichert Bewerbung und Kontakt je einmal
  let bew = false, kon = false;
  for (const [feld, neu] of Object.entries(map)) {
    if (feld === "betreff") { BEW.doc.betreff = neu; if ($("bBetreff")) $("bBetreff").value = neu; bew = true; }
    else if (feld === "kontakt") { TX.set("kontakt", neu); kon = true; }
    else { TX.set(feld, neu); bew = true; }
  }
  if (bew) { TX.after("text"); await bewSave(true); }
  if (kon) await kontaktSave(k, TX.get("kontakt").trim(), true);
  ["kontakt", "text", "bemerkung"].forEach((f) => txRender(f)); bpStatus(); if (bew) renderSend();
}
async function chatSend() {
  const k = S.detailKey, inp = $("chIn"), text = (inp?.value || "").trim();
  if (!k || !text || CH.busy) return;
  if (needPerson()) return;
  const c = await bewCtx();
  if (!c.key) { toast("Zuerst den Claude-Schlüssel hinterlegen (Mehr → «Claude für Bewerbungen»).", "err"); return; }
  CH.msgs.push({ role: "user", by: S.person, text, at: new Date().toISOString() });
  inp.value = ""; inp.style.height = ""; CH.busy = true; CH.live = true; chatRender();
  try {
    await chatEnsureTexts(k);
    if (BEW.edit?.size) bewRead();
    const doc = BEW.doc || {}, verlauf = CH.msgs.slice(-13, -1).map((m) => `${m.role === "user" ? (PEOPLE[m.by] || "Sie") : "Claude"}: ${m.text}`).join("\n");
    const user = kontaktUser(c, `Leonie oder Pascal schreiben dir im Chat zu dieser Wohnung. Stand: ${itemOf(k).status?.value || "noch nichts unternommen"}.
Beantworte Fragen kurz und konkret (du-Form an sie, Schweizer Schreibweise). Wollen sie eine Änderung oder einen neuen Text, liefere in «aenderungen» je Feld den VOLLSTÄNDIGEN neuen Text: kontakt = Kontakt-Nachricht (Erstkontakt vor der Besichtigung), text = Anschreiben (nur Brieftext, ohne Anrede-Zeile), bemerkung = Begleit-Mail bzw. Bemerkung im Online-Formular, betreff = Mail-Betreff. Ändere nur, was verlangt ist; alles andere bleibt wörtlich gleich. Alle Regeln oben gelten (nichts erfinden, Nach-Check Textstil). Fehlt dir eine Angabe, frag nach statt zu raten. Ein allgemeiner Wunsch für künftige Texte → zusätzlich «regel_vorschlaege».

<angaben_der_wohnung>
${angText(angCurrent(k)) || "(keine)"}
Versandweg: ${doc.weg || "(nicht gewählt)"}
Stand: ${stepsText(stepsOf(k))}
Notiz: ${itemOf(k).note || "(leer)"}
</angaben_der_wohnung>
Melden sie einen Schritt (angefragt, Besichtigung am …, besichtigt, beworben, Zusage, Absage), setze «stand». Nennen sie Kontakt der Verwaltung, setze «kontakt». Nützliche Infos ohne eigenen Platz (z.B. «Hunde nicht erlaubt», «Hauswart heisst …») → «notiz». Heute: ${new Date().toISOString().slice(0, 16)}.
Stimmen Angaben nicht (z.B. fehlende Hausnummer im Titel), korrigiere sie in «angaben» (nur geänderte Felder). Erwähnen sie, wie die Bewerbung eingereicht wird (per Mail, über eine Online-Plattform oder ein Online-Formular, über ein Portal wie Flatfox, auf Papier), setze IMMER zusätzlich «weg» (mail, plattform, portal, papier) – auch wenn sie es nur nebenbei sagen.

<texte>
--- Anschreiben (Anrede: ${anredeZeile(doc.anrede, doc.name) || "keine separate, steht im Text"}) ---
${doc.text || "(leer)"}
--- Begleit-Mail (Betreff: ${doc.betreff || "(leer)"}) ---
${doc.bemerkung || "(leer)"}
</texte>

<verlauf>
${verlauf || "(neu)"}
</verlauf>

<nachricht von="${PEOPLE[S.person] || ""}">
${text}
</nachricht>`).replace(/<aktuell>/, "<aktuell_kontakt_nachricht>").replace(/<\/aktuell>/, "</aktuell_kontakt_nachricht>");
    const res = await claudeTool(BEW_SYSTEM.replace("Werkzeug «bewerbung»", "Werkzeug «chat»"), user, CHAT_TOOL, "antwort", "antwort");
    if (CH.k !== k) return;
    const extra = [];
    if (res.angaben && typeof res.angaben === "object") {
      const cur = angCurrent(k), neu = {};
      for (const [f, v] of Object.entries(res.angaben)) if (ANG_LABEL[f] && v !== "" && v != null && String(v) !== String(cur[f])) neu[f] = v;
      if (Object.keys(neu).length) {
        const prev = itemOf(k).shots ? JSON.parse(JSON.stringify(itemOf(k).shots)) : null;
        const alt = Object.fromEntries(Object.keys(neu).map((f) => [f, cur[f]]));
        chatSetAngaben(k, neu);
        extra.push({ feld: "angaben", alt: angText(alt), neu: angText(neu), prevShots: prev, altWerte: alt });
      }
    }
    if (res.kontakt && typeof res.kontakt === "object") {
      const kt = Object.fromEntries(Object.entries(res.kontakt).filter(([f, v]) => ["firma", "name", "telefon", "mail"].includes(f) && v));
      if (Object.keys(kt).length) {
        const prev = itemOf(k).shots ? JSON.parse(JSON.stringify(itemOf(k).shots)) : null, now = new Date().toISOString();
        chatSocial(k, "Kontakt der Verwaltung", (it) => { const sh = it.shots?.status === "ok" ? it.shots : {}; it.shots = { ...sh, status: "ok", kontakt: { ...(sh.kontakt || {}), ...kt }, by: S.person, at: now, quelle: "chat" }; });
        const fi = kt.firma || BEW.d?.agency?.name || hitByKey(k)?.agency; if (fi && (kt.telefon || kt.mail)) agencyAdd(fi, kt).catch(() => { });
        if (kt.mail && BEW.doc && !BEW.doc.an) { BEW.doc.an = kt.mail; renderSend(); }
        extra.push({ feld: "kontakt_vw", alt: "", neu: Object.values(kt).join(", "), prevShots: prev });
      }
    }
    if (res.stand && res.stand.schritt) {
      const prev = JSON.parse(JSON.stringify(stepsOf(k))), st = JSON.parse(JSON.stringify(prev)), now = new Date().toISOString(), me = { by: S.person, at: now };
      const sc = res.stand.schritt;
      if (sc === "zusage" || sc === "absage") st.antwort = { value: sc, ...me };
      else if (sc === "besichtigung") {
        const w = res.stand.termin && !isNaN(new Date(res.stand.termin)) ? new Date(res.stand.termin).toISOString() : st.besichtigung?.when || null;
        st.besichtigung = { ...(st.besichtigung || {}), when: w, ...(res.stand.besichtigt ? { done: true } : {}), ...me };
      } else st[sc] = { ...(st[sc] || {}), ...me };
      if (JSON.stringify(st) !== JSON.stringify(prev)) { chatSetSteps(k, st); extra.push({ feld: "stand", alt: stepsText(prev), neu: stepsText(st), prevSteps: prev }); }
    }
    if (res.notiz && String(res.notiz).trim()) {
      const alt = itemOf(k).note || "", neu = [alt, String(res.notiz).trim()].filter(Boolean).join("\n");
      chatSocial(k, "Notiz", (it) => { it.note = neu; });
      extra.push({ feld: "notiz", alt, neu });
    }
    if (res.weg && WEGE.some(([w]) => w === res.weg) && res.weg !== BEW.doc.weg) {
      extra.push({ feld: "weg", alt: BEW.doc.weg || "", neu: res.weg });
      BEW.doc.weg = res.weg; await bewSave(true); renderSend(); bpStatus();
    }
    const map = {}, changes = [];
    for (const a of (res.aenderungen || [])) {
      if (!a || !CH_FELD[a.feld] || typeof a.neu !== "string") continue;
      const neu = a.neu.replace(/\r/g, "").trim(), alt = a.feld === "betreff" ? BEW.doc.betreff || "" : TX.get(a.feld);
      if (neu && neu !== alt) { map[a.feld] = neu; changes.push({ feld: a.feld, alt, neu }); }
    }
    if (changes.length) await chatSetFields(k, map);
    changes.push(...extra);
    CH.msgs.push({ role: "ki", text: String(res.antwort || "").trim() || "✓", changes, at: new Date().toISOString() });
    const lv = (res.regel_vorschlaege || []).filter((r) => r && r.regel).slice(0, 3);
    if (lv.length) learnBox("chLearn", lv);
    toast(changes.length ? `Geändert: ${changes.map((x) => CH_FELD[x.feld] || CH_EXTRA[x.feld]).join(", ")}` : "Claude hat geantwortet", "ok");
  } catch (e) { CH.msgs.push({ role: "ki", text: "Fehler: " + e.message, error: true, at: new Date().toISOString() }); toast("Claude: " + e.message, "err", 7000); }
  finally { CH.busy = false; chatRender(); chatSave().catch((e) => toast("Chat nicht gespeichert: " + e.message, "err")); const sc = $("chScroll"); if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" }); }
}
async function chatUndo(i) {
  const m = CH.msgs[i]; if (!m || m.undone) return;
  await chatEnsureTexts(CH.k);
  const map = {};
  for (const c of m.changes || []) {
    if (c.feld === "angaben") chatSetAngaben(CH.k, c.altWerte || {}, c.prevShots || null);
    else if (c.feld === "kontakt_vw") chatSocial(CH.k, "Kontakt zurück", (it) => { if (c.prevShots) it.shots = c.prevShots; else delete it.shots; });
    else if (c.feld === "stand") chatSetSteps(CH.k, c.prevSteps || {});
    else if (c.feld === "notiz") chatSocial(CH.k, "Notiz zurück", (it) => { it.note = c.alt; });
    else if (c.feld === "weg") { BEW.doc.weg = c.alt || undefined; if (!c.alt) delete BEW.doc.weg; await bewSave(true); renderSend(); bpStatus(); }
    else map[c.feld] = c.alt;
  }
  if (Object.keys(map).length) await chatSetFields(CH.k, map); m.undone = true; chatRender(); chatSave().catch(() => { }); toast("Rückgängig gemacht", "ok");
}
document.addEventListener("click", (e) => {
  if (e.target.id === "chSend") { chatSend(); return; }
  const u = e.target.closest("[data-chundo]"); if (u) chatUndo(+u.dataset.chundo);
});
document.addEventListener("input", (e) => { if (e.target.id === "chIn") { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; } });
document.addEventListener("keydown", (e) => { if (e.target.id === "chIn" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); chatSend(); } });

function learnBox(id, list) {
  const el = $(id); if (!el) return; KON.learn = list;
  el.innerHTML = `<div class="learn"><div class="ftitle sm">Für künftige Texte merken?</div>
    ${list.map((r, i) => `<label class="lrule"><input type="checkbox" data-klr="${i}" checked><span>${esc(r.regel)}${r.beispiel ? `<small>${esc(r.beispiel)}</small>` : ""}</span></label>`).join("")}
    <div class="brow"><button type="button" class="btn primary" data-klearn="1">Merken</button><button type="button" class="btn" data-klearn="0">Verwerfen</button></div></div>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-klearn]"); if (!b) return;
  const pick = b.dataset.klearn === "1" ? [...document.querySelectorAll("[data-klr]")].filter((c) => c.checked).map((c) => KON.learn[+c.dataset.klr]) : [];
  const box = b.closest(".learn").parentElement; box.innerHTML = ""; KON.learn = null;
  if (!pick.length) return;
  try { await lernSave((list) => list.concat(pick.map((r) => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), regel: r.regel, beispiel: r.beispiel || "", by: S.person, at: new Date().toISOString() }))), "Schreibregel aus Kommentar");
    toast(pick.length === 1 ? "Regel gemerkt." : `${pick.length} Regeln gemerkt.`, "ok"); } catch (er) { toast("Merken fehlgeschlagen: " + er.message, "err"); }
});

