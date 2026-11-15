"use strict";
// ---------- Karte ----------
const OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const baseLayer = (extra = {}) => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: OSM, ...extra });

function ensureMap() {
  if (S.map) { setTimeout(() => S.map.invalidateSize(), 60); return; }
  S.map = L.map("map", { zoomControl: false }).setView([47.345, 8.53], 14);
  L.control.zoom({ position: "bottomright" }).addTo(S.map);
  baseLayer().addTo(S.map);
  S.map.pm.setLang("de");
  S.map.pm.addControls({ position: "topleft", drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawCircle: false,
    drawText: false, cutPolygon: false, rotateMode: false, drawRectangle: true, drawPolygon: true, editMode: true, dragMode: false, removalMode: true });
  S.map.pm.setPathOptions({ color: accent(), weight: 2, fillOpacity: 0.12 });
  S.map.on("pm:create", (e) => { markAreaDirty(); e.layer.on(EDIT_EVENTS, markAreaDirty); });
  S.map.on("pm:remove", markAreaDirty);
  S.map.on("pm:globaleditmodetoggled", (e) => { if (!e.enabled && S.areasDirty) toast("Zum Übernehmen unten «Speichern» tippen."); });
  S.refLayer = L.layerGroup().addTo(S.map);
  S.hitLayer = L.layerGroup().addTo(S.map);
  drawAreas(); renderMarkers();
  setTimeout(() => S.map.invalidateSize(), 60);
}
// Zwei Gebiete: Suche (was gesucht wird) und Push & Briefing (was gemeldet wird; leer = wie Suche)
S.amode = "search"; S.work = null;
const hasFeat = (fc) => !!(fc && fc.features && fc.features.length);
const pushAreasOf = (c) => (hasFeat(c?.push?.areas) ? c.push.areas : null);
function drawAreas(force = false) {
  if (!S.map || !S.config) return;
  if (S.areasDirty && !force) return;   // ungespeicherte Änderungen nicht überschreiben
  // Push-Gebiet ist immer eigenständig; fehlt es, startet es als Kopie des App-Suchgebiets
  S.work = { search: S.config.areas, push: pushAreasOf(S.config) || JSON.parse(JSON.stringify(S.config.areas)) };
  paintAreas(true);
  S.areasDirty = false; S.areasDrawn = true;
  $("areaState").hidden = true;
}
function paintAreas(fit) {
  S.map.pm.getGeomanLayers().forEach((l) => l.remove());
  S.refLayer.clearLayers();
  const mine = S.amode === "push" ? S.work.push : S.work.search;
  const other = S.amode === "push" ? S.work.search : S.work.push;
  if (other) L.geoJSON(other, { pmIgnore: true, interactive: false,
    style: { color: "#7a7a7a", weight: 2, dashArray: "6 6", fillOpacity: S.amode === "push" ? 0.06 : 0 } }).addTo(S.refLayer);
  const g = L.geoJSON(mine || { type: "FeatureCollection", features: [] }, { style: { color: accent(), weight: 3, fillOpacity: 0.14 } });
  g.eachLayer((l) => { l.addTo(S.map); l.on(EDIT_EVENTS, markAreaDirty); });
  if (fit && !S.focus) { try { S.map.fitBounds((mine && hasFeat(mine) ? g : L.geoJSON(S.work.search)).getBounds(), { padding: [24, 24] }); } catch {} }
  renderAreaUi(); renderMarkers();
}
function renderAreaUi() {
  $("pushAreaBtns").hidden = S.amode !== "push";
  const own = S.work && hasFeat(S.work.push);
  $("searchAreaBtns").hidden = S.amode !== "search";
  fitMap();
  $("areaHint").textContent = S.amode === "search"
    ? "Mit dem Fünfeck links zeichnen, mit dem Stift anpassen, mit dem Radiergummi löschen. Gestrichelt: das Gebiet von «Push & Mail»."
    : own ? "Gestrichelt: das Gebiet von «Suche». Ausserhalb davon wird nicht gesucht."
      : "Noch keine Fläche: Zeichne eine oder übernimm das Gebiet von «Suche». Bis dahin gilt dieses.";
}
function grabWork() {
  if (!S.map || !S.work) return;
  const fc = collectFromMap();
  if (S.amode === "push") S.work.push = hasFeat(fc) ? fc : null; else S.work.search = fc;
}
function setAreaMode(m) {
  if (!S.map || !S.work || m === S.amode) return;
  grabWork(); S.amode = m; paintAreas(false);
}
// Umschalter Anzeigen | Push & Mail (Gebiet und Kriterien zusammen)
function setSearchMode(m) {
  F.ctab = m === "notify" ? "notify" : "search";
  $("cs-search").hidden = m === "notify"; $("cs-notify").hidden = m !== "notify";
  $("sumShowBox").hidden = m === "notify"; $("sumNotifyBox").hidden = m !== "notify";
  $("pushBar").hidden = m !== "notify";
  document.querySelectorAll("#v-search [data-stab]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.stab === m)));
  $("modeHint").textContent = m === "notify"
    ? "Push-Mitteilungen und das tägliche Briefing per Mail kommen nur für Wohnungen, die auch angezeigt werden. Gebiet und Kriterien hier also gleich oder enger setzen."
    : "Nur in diesem Gebiet und mit diesen Kriterien wird gesucht. Das erscheint in der Trefferliste.";
  if (S.map && S.work) setAreaMode(m === "notify" ? "push" : "search"); else S.amode = m === "notify" ? "push" : "search";
  renderAreaUi();
}
$("v-search").addEventListener("click", (e) => { if (e.target.id === "outToggle") { S.showOutOnMap = !S.showOutOnMap; renderMarkers(); } });
$("v-search").addEventListener("click", (e) => { const b = e.target.closest("[data-stab]"); if (b) { setSearchMode(b.dataset.stab); window.scrollTo(0, 0); } });
$("paCopy").addEventListener("click", () => { if (!S.work) return; grabWork(); S.work.push = JSON.parse(JSON.stringify(S.work.search)); paintAreas(true); markAreaDirty(); toast("Gebiet von «Suche» übernommen. Unten «Speichern» tippen."); });
$("saCopy").addEventListener("click", () => { if (!S.work) return; grabWork(); if (!hasFeat(S.work.push)) { toast("«Push & Mail» hat noch kein eigenes Gebiet.", "err"); return; } S.work.search = JSON.parse(JSON.stringify(S.work.push)); paintAreas(true); markAreaDirty(); toast("Gebiet von «Push & Mail» übernommen. Unten «Speichern» tippen."); });
// Karte genau zwischen Knöpfen oben und «Gebiet speichern» einpassen
function fitMap() {
  const el = $("map"); if (!el || $("v-search").hidden) return;
  // fast bildschirmhoch: zwischen Kopfzeile und Speichern-Knopf
  const head = document.querySelector(".appbar") ? document.querySelector(".appbar").getBoundingClientRect().height : 0;
  const bar = document.querySelector("#v-search .savebar");
  const tab = $("tabbar") ? $("tabbar").getBoundingClientRect().height : 60;
  const h = Math.max(220, Math.floor((window.innerHeight - head - (bar ? bar.offsetHeight : 56) - tab - 40) * 2 / 3));
  el.style.height = h + "px";
  if (S.map) S.map.invalidateSize();
}
window.addEventListener("resize", () => fitMap());
function renderMarkers() {
  if (!S.hitLayer) return;
  S.hitLayer.clearLayers();
  S.markers = {};
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let nOut = 0;
  S.hits.forEach((x) => {
    const k = keyOf(x);
    if (x.lat == null || !inSavedArea(x)) return;
    const out = verdict(k) === "out";
    if (out) { nOut++; if (!S.showOutOnMap) return; }
    const st = itemOf(k).status?.value;
    const outPush = S.amode === "push" && S.work && hasFeat(S.work.push) && !inAreas(x.lat, x.lon, S.work.push);
    // Farbe mit Bedeutung: grau = aussortiert / ausserhalb Push, grün = läuft schon, gelb = Favorit, blau = offen
    const c = out || outPush ? "#9a9a9a" : st ? css("--ok") : isFav(k) ? css("--star") : accent();
    S.markers[k] = L.circleMarker([x.lat, x.lon], { radius: out ? 6 : 8, color: "#fff", weight: 2, fillColor: c, fillOpacity: out ? 0.6 : 0.95, pmIgnore: true })
      .bindPopup(`${x.image ? `<img src="${esc(x.image)}" alt="" style="width:200px;height:112px;object-fit:cover;border-radius:6px;display:block;margin-bottom:6px" referrerpolicy="no-referrer">` : ""}<b>${esc(chf(x.rent))} · ${esc(rooms(x.rooms))}${x.m2 ? " · " + esc(x.m2) + " m²" : ""}</b><br>${esc(x.street || "")}<br><a href="#" data-k="${esc(keyOf(x))}" onclick="openDetail(this.dataset.k);return false">Details</a> · <a href="${esc(goodUrl(x))}" target="_blank" rel="noopener">Inserat ↗</a>`, { maxWidth: 220 })
      .addTo(S.hitLayer);
  });
  const t = $("outToggle");
  if (t) { t.hidden = !nOut; t.textContent = S.showOutOnMap ? `Aussortierte ausblenden (${nOut})` : `Aussortierte zeigen (${nOut})`; }
}
function collectFromMap() {
  const features = [];
  S.map.pm.getGeomanLayers().forEach((l) => { if (l instanceof L.Polygon) { const f = l.toGeoJSON(6); f.properties = f.properties || {}; features.push(f); } });
  return { type: "FeatureCollection", features };
}
function collectAreas() {
  if (!S.map || !S.areasDrawn) return S.config.areas;
  grabWork(); return S.work.search;
}
function collectPushAreas() {
  if (!S.map || !S.areasDrawn) return pushAreasOf(S.config);
  grabWork(); return S.work.push;
}
// Liegt das Push-Gebiet (teilweise) ausserhalb des Suchgebiets?
function pushOutside(search, push) {
  if (!hasFeat(push)) return false;
  return push.features.some((f) => {
    const g = f.geometry || {}; const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.some((p) => p[0].some(([lon, lat]) => !inAreas(lat, lon, search)));
  });
}
function markAreaDirty() {
  S.areasDirty = true;
  $("areaState").textContent = "Gebiet geändert, noch nicht gespeichert.";
  $("areaState").className = "toast err"; $("areaState").hidden = false;
  if (S.amode === "push" && S.work) { grabWork(); renderMarkers(); renderAreaUi(); }
  fitMap();
}
const EDIT_EVENTS = "pm:edit pm:markerdragend pm:vertexadded pm:vertexremoved pm:dragend pm:rotateend";
// Punkt in Fläche (wie im Suchskript), damit die Liste sofort zum gespeicherten Gebiet passt
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
function inAreas(lat, lon, areas) {
  return (areas?.features || []).some((f) => {
    const g = f.geometry || {};
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys.some((p) => inRing(lon, lat, p[0]) && !p.slice(1).some((h) => inRing(lon, lat, h)));
  });
}

// ---------- Kriterien ----------
const lines = (t) => t.split("\n").map((s) => s.trim()).filter(Boolean);
const FEATURES = { aussen: "Aussenraum (Balkon, Terrasse, Sitzplatz oder Garten)", garten: "Garten", lift: "Lift", haustiere: "Haustiere erlaubt",
  waschturm: "Eigene Wasch\u00ADmaschine", altbau: "Altbau", neubau: "Neubau", aussicht: "Seesicht",
  rollstuhl: "Rollstuhl\u00ADgängig", parkplatz: "Parkplatz" };
const FEATURE_ALIAS = { balkon: "aussen" };
const featKeys = (list) => [...new Set((list || []).map((k) => FEATURE_ALIAS[k] || k))].filter((k) => FEATURES[k]);
const featShort = (k) => (k === "aussen" ? "Aussenraum" : FEATURES[k]);
// alte Einstellung «Balkon oder Garten» → Aussenraum
const migrateFeat = (c) => (c.features_mode === "any" && (c.features_required || []).length && (c.features_required || []).every((k) => ["balkon", "garten", "aussen"].includes(k))
  ? ["aussen"] : featKeys(c.features_required));
const EXCL = { befristet: "Befristete Verträge", moebliert: "Möbliert", untermiete: "Untermiete", alter: "Alters\u00ADwohnungen", wg: "WG-Zimmer", tausch: "Tausch\u00ADwohnungen" };
const ROOMS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7];
const RENTS = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000, 4500, 5000, 6000];
const M2 = [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 200];
const BEFR = [[6, "6 Monate"], [12, "1 Jahr"], [18, "1½ Jahre"], [24, "2 Jahre"], [30, "2½ Jahre"], [36, "3 Jahre"], [42, "3½ Jahre"], [48, "4 Jahre"]];
const CRIT_KEYS = ["object_types", "rooms_min", "rooms_max", "rent_min", "rent_max", "m2_min", "m2_max", "features_required",
  "features_mode", "exclude_groups", "befristet_min_months", "include_unknown_price", "include_unknown_rooms"];
const CS = { s: { rooms: [null, null], types: new Set(["APARTMENT"]), fmode: "all" }, n: { rooms: [null, null], types: new Set(["APARTMENT"]), fmode: "all" } };
const F = { recips: [], days: "daily", ctab: "search" };
const fmtN = (v) => Number(v).toLocaleString("de-CH");

function critMarkup(p) {
  const checks = (obj, attr) => Object.entries(obj).map(([k, l]) =>
    `<label class="check" for="${p}-${attr}-${k}"><input type="checkbox" id="${p}-${attr}-${k}" data-${attr}="${k}"><span class="cl">${k === "aussen" ? "Aussenraum<small>Balkon, Terrasse, Sitzplatz, Garten</small>" : l}</span></label>`).join("");
  return `
  <div class="panel">
    <div class="ftitle">Objektart</div>
    <div class="seg">
      <button type="button" class="opt" data-type="APARTMENT">Wohnung</button>
      <button type="button" class="opt" data-type="HOUSE">Haus</button>
    </div>
  </div>
  <div class="panel">
    <div class="ftitle">Zimmer <span class="fval" data-roomsval></span></div>
    <div class="rooms">${ROOMS.map((r) => `<button type="button" data-room="${r}">${r === 7 ? "7+" : r}</button>`).join("")}</div>
    <p class="hint">Erst das Minimum, dann das Maximum antippen.</p>
  </div>
  <div class="panel">
    <div class="ftitle">Miete pro Monat <span class="fval">brutto</span></div>
    <div class="row2">
      <label class="f" for="${p}RentMin"><small>von</small><select class="field" id="${p}RentMin"></select></label>
      <label class="f" for="${p}RentMax"><small>bis</small><select class="field" id="${p}RentMax"></select></label>
    </div>
    <div class="ftitle" style="margin-top:4px">Wohnfläche</div>
    <div class="row2">
      <label class="f" for="${p}M2Min"><small>von</small><select class="field" id="${p}M2Min"></select></label>
      <label class="f" for="${p}M2Max"><small>bis</small><select class="field" id="${p}M2Max"></select></label>
    </div>
  </div>
  <div class="panel">
    <div class="ftitle">Muss haben</div>
    <div class="checks">${checks(FEATURES, "feat")}</div>
    <p class="hint">Jedes Häkchen muss erfüllt sein. Hat ein Inserat zu wenig Text, um das zu prüfen, kommt es trotzdem, mit dem Hinweis «Ausstattung ungeprüft».</p>
  </div>
  <div class="panel">
    <div class="ftitle">Nicht anzeigen</div>
    <div class="checks">${checks(EXCL, "excl")}</div>
    <label class="f" for="${p}Befr" data-befrrow><small>Befristete trotzdem, wenn die Dauer mindestens …</small>
      <select class="field" id="${p}Befr"><option value="">nie, alle befristeten ausblenden</option>${BEFR.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
    ${p === "s" ? '<label class="f" for="exclWords">Weitere Wörter, die ausschliessen<small>Ein Wort pro Zeile, zum Beispiel «Parkplatz» oder «Büro»</small><textarea class="field" id="exclWords"></textarea></label>' : ""}
  </div>
  ${p === "n" ? `<div class="panel">
    <div class="ftitle">Unvollständige Inserate</div>
    <label class="switch" for="pushIncomplete"><span>Auch melden, wenn Angaben fehlen<small class="sw-sub">Miete, Zimmer, genaue Lage oder Ausstattung nicht im Inserat. Angezeigt werden solche Wohnungen immer.</small></span><input type="checkbox" id="pushIncomplete"></label>
  </div>` : ""}`;
}
const root = (p) => $(p === "s" ? "critS" : "critN");
function opts(sel, values, fmt, anyLabel, current) {
  const list = current != null && !values.includes(current) ? [...values, current].sort((a, b) => a - b) : values;
  $(sel).innerHTML = `<option value="">${anyLabel}</option>` + list.map((v) => `<option value="${v}">${fmt(v)}</option>`).join("");
  $(sel).value = current ?? "";
}
function renderCrit(p) {
  const st = CS[p], r = root(p), [a, b] = st.rooms;
  r.querySelectorAll("[data-room]").forEach((el) => {
    const v = +el.dataset.room;
    el.classList.toggle("end", v === a || v === b);
    el.classList.toggle("in", a != null && b != null && v > a && v < b);
  });
  r.querySelector("[data-roomsval]").textContent = a == null ? "beliebig" : a === b ? `${a}` : `${a} – ${b === 7 ? "7+" : b}`;
  r.querySelectorAll("[data-type]").forEach((el) => el.setAttribute("aria-pressed", String(st.types.has(el.dataset.type))));
  r.querySelector("[data-befrrow]").hidden = !r.querySelector("[data-excl=befristet]").checked;
}
function setCrit(p, c) {
  const st = CS[p], r = root(p);
  st.types = new Set(c.object_types && c.object_types.length ? c.object_types : ["APARTMENT"]);
  const rmax = c.rooms_max != null && c.rooms_max >= 7 ? 7 : c.rooms_max;
  st.rooms = [c.rooms_min ?? null, rmax ?? c.rooms_min ?? null];
  opts(p + "RentMin", RENTS, (v) => `CHF ${fmtN(v)}`, "beliebig", c.rent_min ?? null);
  opts(p + "RentMax", RENTS, (v) => `CHF ${fmtN(v)}`, "beliebig", c.rent_max ?? null);
  opts(p + "M2Min", M2, (v) => `${v} m²`, "beliebig", c.m2_min ?? null);
  opts(p + "M2Max", M2, (v) => `${v} m²`, "beliebig", c.m2_max ?? null);
  r.querySelectorAll("[data-feat]").forEach((el) => (el.checked = migrateFeat(c).includes(el.dataset.feat)));
  r.querySelectorAll("[data-excl]").forEach((el) => (el.checked = (c.exclude_groups || []).includes(el.dataset.excl)));
  $(p + "Befr").value = c.befristet_min_months ? String(c.befristet_min_months) : "";
  renderCrit(p);
}
function getCrit(p) {
  const st = CS[p], r = root(p);
  const sel = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  return {
    object_types: [...st.types],
    rooms_min: st.rooms[0], rooms_max: st.rooms[1] == null ? null : (st.rooms[1] >= 7 ? 99 : st.rooms[1]),
    rent_min: sel(p + "RentMin"), rent_max: sel(p + "RentMax"), m2_min: sel(p + "M2Min"), m2_max: sel(p + "M2Max"),
    features_required: [...r.querySelectorAll("[data-feat]:checked")].map((el) => el.dataset.feat),
    features_mode: "all",
    exclude_groups: [...r.querySelectorAll("[data-excl]:checked")].map((el) => el.dataset.excl),
    befristet_min_months: $(p + "Befr").value ? +$(p + "Befr").value : null,
    include_unknown_price: true, include_unknown_rooms: true,   // fehlende Angaben werden immer gezeigt
  };
}
function wireCrit(p) {
  const r = root(p);
  r.innerHTML = critMarkup(p);
  r.addEventListener("click", (e) => {
    const st = CS[p];
    const room = e.target.closest("[data-room]");
    if (room) {
      const v = +room.dataset.room; let [a, b] = st.rooms;
      if (a == null || a !== b) { a = b = v; } else if (v === a) { a = b = null; } else if (v < a) { b = a; a = v; } else { b = v; }
      st.rooms = [a, b];
    }
    const t = e.target.closest("[data-type]");
    if (t) { const k = t.dataset.type; if (st.types.has(k) && st.types.size > 1) st.types.delete(k); else st.types.add(k); }
    if (room || t) { renderCrit(p); renderSummary(); }
  });
  r.addEventListener("change", () => { renderCrit(p); renderSummary(); });
}
function critParts(c) {
  const parts = [];
  parts.push(c.object_types.length > 1 ? "Wohnung oder Haus" : c.object_types[0] === "HOUSE" ? "Haus" : "Wohnung");
  if (c.rooms_min != null) parts.push(c.rooms_min === c.rooms_max ? `${c.rooms_min} Zi.` : `${c.rooms_min}–${c.rooms_max >= 7 ? "7+" : c.rooms_max} Zi.`);
  if (c.rent_min || c.rent_max) parts.push(c.rent_min && c.rent_max ? `CHF ${fmtN(c.rent_min)}–${fmtN(c.rent_max)}` : c.rent_max ? `bis CHF ${fmtN(c.rent_max)}` : `ab CHF ${fmtN(c.rent_min)}`);
  if (c.m2_min || c.m2_max) parts.push(c.m2_min && c.m2_max ? `${c.m2_min}–${c.m2_max} m²` : c.m2_min ? `ab ${c.m2_min} m²` : `bis ${c.m2_max} m²`);
  if (c.features_required.length) parts.push(featKeys(c.features_required).map(featShort).join(" + "));
  if (c.exclude_groups.includes("befristet") && c.befristet_min_months) parts.push(`befristet ab ${(BEFR.find(([v]) => v === c.befristet_min_months) || [0, c.befristet_min_months + " Mt."])[1]}`);
  if (!c.exclude_groups.includes("befristet")) parts.push("auch befristete");
  return parts;
}
function renderSummary() {
  if (!S.config) return;
  const s = getCrit("s"), n = getCrit("n");
  $("sumSearch").textContent = ($("active").checked ? "" : "Pausiert · ") + critParts(s).join(" · ");
  const ps = critParts(s), pn = critParts(n);
  $("sumNotify").textContent = pn.join(" · ");
  const diff = pn.filter((x) => !ps.includes(x));
  const chans = [];
  if (!$("dgOn").checked) chans.push("Briefing aus");
  else if (F.recips.length) chans.push(`Briefing ${F.days === "weekdays" ? "Mo–Fr" : "täglich"} ${$("dgTime").value} an ${F.recips.length}`);
  const sa = S.work ? S.work.search : S.config.areas, pa = S.work ? S.work.push : pushAreasOf(S.config);
  const ownArea = pa && JSON.stringify(pa) !== JSON.stringify(sa) ? ["eigenes Gebiet"] : [];
  $("sumNotifyDiff").textContent = (diff.length || ownArea.length ? "Enger als «Suche»: " + [...diff, ...ownArea].join(" · ") : "Gleich wie «Suche»") + (chans.length ? " · " + chans.join(" · ") : "");
  if ($("pushInfoText")) $("pushInfoText").textContent = (diff.length || ownArea.length ? "Push und Briefing nur bei: " + [...diff, ...ownArea].join(" · ") : "Push und Briefing kommen für alle Treffer, die hier angezeigt werden.") + (chans.length ? " · " + chans.join(" · ") : "");
}
$("copyCrit").addEventListener("click", () => { setCrit("n", getCrit("s")); renderSummary(); toast("Kriterien von «Suche» übernommen. Anpassen und speichern."); });
$("copyCritBack").addEventListener("click", () => { setCrit("s", getCrit("n")); renderSummary(); toast("Kriterien von «Push & Mail» übernommen. Anpassen und speichern."); });

function renderRecheckHint() {
  $("recheckHint").textContent = `Beim Speichern prüft Wollihood auch die aussortierten Inserate der letzten ${$("recheckDays").value || 14} Tage nochmals. Ändern unter Mehr → Erweitert.`;
}
$("recheckDays").addEventListener("change", renderRecheckHint);
function fillForm() {
  const c = S.config;
  $("active").checked = c.active !== false;
  setCrit("s", c);
  const p = c.push || {};
  setCrit("n", { ...Object.fromEntries(CRIT_KEYS.map((k) => [k, c[k]])), ...(p.criteria || {}) });
  $("recheckDays").value = String(c.recheck_days || 14); renderRecheckHint();
  $("exclWords").value = [...new Set([...(c.exclude_keywords || []), ...(c.title_exclude_keywords || [])])].join("\n");
  const src = c.sources || {};
  $("srcMail").checked = src.mail_alerts !== false; $("srcFlatfox").checked = src.flatfox !== false; $("srcPages").checked = src.watch_pages !== false;
  $("pages").value = (c.watch_pages || []).map((x) => `${x.name} | ${x.url}`).join("\n");
  $("pushIncomplete").checked = p.allow_incomplete !== false;
  const d = c.digest || { enabled: true, to: [], time: "07:00", days: "daily", skip_empty: true };
  $("dgOn").checked = d.enabled !== false;
  F.recips = [...(d.to || [])]; F.days = d.days || "daily";
  $("dgTime").value = d.time || "07:00"; if (!$("dgTime").value) $("dgTime").value = "07:00";
  $("dgSkip").checked = d.skip_empty !== false;
  renderChannels();
}
function readForm() {
  const c = structuredClone(S.config);
  const sel = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
  c.active = $("active").checked;
  Object.assign(c, getCrit("s"));
  c.exclude_keywords = lines($("exclWords").value);
  c.recheck_days = +$("recheckDays").value || 14;
  c.title_exclude_keywords = [];
  c.sources = { mail_alerts: $("srcMail").checked, flatfox: $("srcFlatfox").checked, watch_pages: $("srcPages").checked };
  const old = Object.fromEntries((S.config.watch_pages || []).map((x) => [x.url, x]));
  c.watch_pages = lines($("pages").value).map((ln) => {
    const [name, url] = ln.includes("|") ? ln.split("|").map((s) => s.trim()) : [ln, ln];
    return { ...(old[url] || {}), name: name || url, url };
  }).filter((x) => /^https?:\/\//.test(x.url));
  // Ob jemand Push bekommt, regelt jede Person unter Einstellungen; hier nur, was meldenswert ist
  c.push = { enabled: true, mail_alerts: true, flatfox: true, pages: true,
    allow_incomplete: $("pushIncomplete").checked, criteria: getCrit("n") };
  delete c.digest_to;
  const typed = $("dgAdd").value.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed) && !F.recips.includes(typed)) { F.recips.push(typed); $("dgAdd").value = ""; setTimeout(renderChannels); }
  c.digest = { enabled: $("dgOn").checked, to: [...F.recips], time: $("dgTime").value, days: F.days, skip_empty: $("dgSkip").checked };
  c.areas = collectAreas();
  const pa = collectPushAreas();
  c.push.areas = pa || { type: "FeatureCollection", features: [] };
  return c;
}
function validate(c) {
  if (!c.areas.features.length) return "Bitte mindestens eine Fläche einzeichnen.";
  for (const [label, k] of [["Anzeigen", c], ["Push & Mail", c.push.criteria]]) {
    if (k.rent_min && k.rent_max && k.rent_min > k.rent_max) return `${label}: Die Mindestmiete ist höher als die Höchstmiete.`;
    if (k.m2_min && k.m2_max && k.m2_min > k.m2_max) return `${label}: Die Mindestfläche ist grösser als die Höchstfläche.`;
  }
  return null;
}
function renderChannels() {
  $("dgList").innerHTML = F.recips.length ? F.recips.map((m, i) => `<div class="recip"><span>${esc(m)}</span><button type="button" data-rm="${i}" aria-label="${esc(m)} entfernen">${icon.x}</button></div>`).join("")
    : '<p class="hint">Noch keine Empfänger.</p>';
  document.querySelectorAll("[data-days]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.days === F.days)));
  $("dgRules").classList.toggle("off", !$("dgOn").checked);
  renderSummary();
}
function addRecipient() {
  const v = $("dgAdd").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("Bitte eine gültige E-Mail-Adresse eingeben.", "err"); return; }
  if (!F.recips.includes(v)) F.recips.push(v);
  $("dgAdd").value = ""; renderChannels(); toast("Hinzugefügt. Zum Übernehmen unten speichern.");
}
(function buildStatic() {
  wireCrit("s"); wireCrit("n");
  const times = []; for (let h = 6; h <= 22; h++) for (const m of ["00", "30"]) times.push(`${String(h).padStart(2, "0")}:${m}`);
  $("dgTime").innerHTML = times.map((t) => `<option value="${t}">${t} Uhr</option>`).join("");
  const hours = [...Array(24).keys()];
  opts("myQuietFrom", hours, (h) => `${h}:00`, "keine", null);
  opts("myQuietTo", hours, (h) => `${h}:00`, "–", null);
  setSearchMode("show");
})();
$("cs-search").addEventListener("change", renderSummary);
$("cs-notify").addEventListener("change", renderChannels);
$("digestPanel").addEventListener("change", renderChannels);
$("dgAddBtn").addEventListener("click", addRecipient);
$("dgAdd").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } });
$("dgList").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (!b) return; F.recips.splice(+b.dataset.rm, 1); renderChannels(); toast("Entfernt. Zum Übernehmen unten speichern."); });
$("dgDays").addEventListener("click", (e) => { const b = e.target.closest("[data-days]"); if (!b) return; F.days = b.dataset.days; renderChannels(); });
$("dgNow").addEventListener("click", async () => {
  const c = readForm(); const p = validate(c); if (p) { toast(p, "err"); return; }
  if (!c.digest.to.length) { toast("Bitte zuerst einen Empfänger hinzufügen.", "err"); return; }
  c.digest_requested_at = new Date().toISOString();
  $("dgNow").disabled = true;
  await saveConfig(c, "Briefing von Hand angefordert", "Gespeichert. Das Briefing kommt in ein, zwei Minuten.");
  setTimeout(() => ($("dgNow").disabled = false), 60000);
});

async function saveConfig(c, message, okText) {
  try {
    S.configSha = await writeJson("config.json", c, S.configSha, message);
    S.config = c; S.areasDirty = false; $("areaState").hidden = true; fitMap();
    try { S.formBase = JSON.stringify(readForm()); } catch { } searchDirtySync();
    if (pushOutside(c.areas, c.push && c.push.areas)) toast("Hinweis: Ein Teil des Push-Gebiets liegt ausserhalb des Suchgebiets. Dort wird nicht gesucht.", "", 8000);
    renderHits(); renderMarkers();
    toast(okText, "ok", 6000);
    return true;
  } catch (e) { toast(e.message, "err", 8000); return false; }
}
{ const f0 = fillForm; fillForm = function () { f0(); try { S.formBase = JSON.stringify(readForm()); } catch { } setTimeout(searchDirtySync, 0); }; }
// v93: «Speichern» der Suche nur blau, wenn etwas geändert ist (UX-Check 15.11.)
function searchDirtySync() {
  const b = document.querySelector("#v-search [data-save]"); if (!b || !S.config) return;
  let d = !!S.areasDirty; try { d = d || JSON.stringify(readForm()) !== S.formBase; } catch { d = true; }
  b.classList.toggle("primary", d); b.textContent = "Speichern"; b.disabled = !d;
  b.hidden = !d;     // nichts geändert → kein schwebender Knopf über der Karte
}
["input", "change", "click"].forEach((ev) => document.addEventListener(ev, (e) => { if (e.target.closest?.("#v-search")) setTimeout(searchDirtySync, 0); }));
document.querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
  const c = readForm(); const p = validate(c);
  if (p) { toast(p, "err"); return; }
  b.disabled = true;
  await saveConfig(c, "Kriterien angepasst", "Gespeichert. In ein, zwei Minuten sucht Wollihood mit den neuen Einstellungen.");
  b.disabled = false;
}));

