"use strict";
// --- Fest (v106, Pascal 17.11.: «eine Überraschung, sobald wir eine Zusage bekommen und auf Zusage klicken») ---
// Läuft einmal pro Gerät und Wohnung, sobald die Antwort «Zusage» gesetzt ist (Knopf, Chat oder bei der anderen Person
// beim nächsten Öffnen der Wohnung). Nur innert 30 Tagen nach der Zusage. Merkt sich localStorage «wh_fest_<key>».
const FEST_KEY = (k) => "wh_fest_" + k;
function festCheck(k) {
  if (!k || S.detailKey !== k || $("fest")) return;
  const a = stepsOf(k).antwort;
  if (a?.value !== "zusage") return;
  if (a.at && Date.now() - new Date(a.at).getTime() > 30 * 864e5) return;
  try { if (localStorage.getItem(FEST_KEY(k))) return; localStorage.setItem(FEST_KEY(k), new Date().toISOString()); } catch { }
  setTimeout(() => festShow(k), 350);
}
function festZahlen(k) {
  const items = Object.values(S.social || {});
  const dates = [...Object.values(S.archive || {}).map((v) => v.archived_at), ...(S.hits || []).map((h) => h.first_seen)]
    .filter(Boolean).map((d) => new Date(d).getTime()).filter((t) => !isNaN(t));
  const start = dates.length ? Math.min(...dates) : Date.now();
  const end = new Date(stepsOf(k).antwort?.at || Date.now()).getTime();
  const st = (it) => it.steps || {};
  return {
    start, tage: Math.max(1, Math.ceil((end - start) / 864e5)),
    daumen: items.reduce((n, it) => n + Object.keys(it.votes || {}).length, 0),
    besichtigt: items.filter((it) => st(it).besichtigung?.when || st(it).besichtigung?.done).length,
    beworben: items.filter((it) => st(it).bewerbung).length,
  };
}
function festShow(k) {
  const x = hitByKey(k) || {}, z = festZahlen(k);
  const a = stepsOf(k).antwort || {}, du = PEOPLE[S.person === "pascal" ? "leonie" : "pascal"];
  const gruss = a.by && a.by !== S.person ? `${esc(PEOPLE[a.by] || a.by)} hat die Zusage eingetragen.` : `Jetzt aber schnell ${esc(du)} Bescheid geben!`;
  const zeilen = [
    [z.tage, z.tage === 1 ? "Tag gesucht" : "Tage gesucht", `seit dem ${new Date(z.start).toLocaleDateString("de-CH", { day: "numeric", month: "long" })}`],
    [z.daumen, "Daumen verteilt", "👍 und 👎 von euch beiden"],
    [z.besichtigt, z.besichtigt === 1 ? "Besichtigung" : "Besichtigungen", "Treppenhäuser, Grundrisse, Waschküchen"],
    [z.beworben, z.beworben === 1 ? "Bewerbung" : "Bewerbungen", "und diese hier hat geklappt"],
  ].filter(([n]) => n > 0);
  const el = document.createElement("div");
  el.id = "fest"; el.className = "fest"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Zusage");
  el.innerHTML = `<canvas class="fest-cv"></canvas>
    <div class="fest-card">
      <svg class="fest-haus" viewBox="0 0 120 110" aria-hidden="true">
        <path class="fest-dach" d="M10 52 60 12l50 40"/>
        <rect class="fest-wand" x="22" y="46" width="76" height="56" rx="3"/>
        <rect class="fest-fenster f1" x="32" y="56" width="18" height="16" rx="2"/>
        <rect class="fest-fenster f2" x="70" y="56" width="18" height="16" rx="2"/>
        <rect class="fest-tuer" x="51" y="72" width="18" height="30" rx="2"/>
        <circle class="fest-herz" cx="60" cy="34" r="0"/>
      </svg>
      <div class="fest-zu">Zusage!</div>
      <p class="fest-lead">${esc(placeName(x))} wird euer Zuhause.</p>
      <div class="fest-zahlen">${zeilen.map(([n, l, s], i) => `<div style="animation-delay:${1.1 + i * 0.35}s"><b data-n="${n}">0</b><span>${esc(l)}<small>${esc(s)}</small></span></div>`).join("")}</div>
      <p class="fest-gruss">${gruss}<br>Wollihood darf jetzt in die Ferien. 🏖️</p>
      <button type="button" class="btn primary fest-ok">Danke, Wollihood 🏡</button>
    </div>`;
  document.body.appendChild(el);
  try { navigator.vibrate?.([80, 60, 80, 60, 200]); } catch { }
  // Zahlen hochzählen
  el.querySelectorAll("[data-n]").forEach((b, i) => {
    const n = +b.dataset.n, t0 = performance.now() + 1100 + i * 350, dur = 900;
    const step = (t) => { const p = Math.min(1, Math.max(0, (t - t0) / dur)); b.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
  const stop = festKonfetti(el.querySelector(".fest-cv"));
  const zu = () => { stop(); el.classList.add("fest-weg"); setTimeout(() => el.remove(), 350); document.removeEventListener("keydown", esc_, true); };
  const esc_ = (e) => { if (e.key === "Escape") { e.stopImmediatePropagation(); zu(); } };
  document.addEventListener("keydown", esc_, true);
  el.querySelector(".fest-ok").addEventListener("click", zu);
  // Antippen des Hauses: nochmals Konfetti
  el.querySelector(".fest-haus").addEventListener("click", () => festKonfetti(el.querySelector(".fest-cv"), 90));
}
function festKonfetti(cv, menge) {
  const ruhig = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr);
  const farben = ["#0075BF", "#1E7A46", "#FFD400", "#E4572E", "#A855F7", "#2E9BE6", "#FF8FB1"], zeichen = ["🏠", "🔑", "🎉", "📦", "🪴"];
  const n = menge || (ruhig ? 40 : 170);
  const teile = Array.from({ length: n }, (_, i) => ({
    x: W * (0.5 + (Math.random() - 0.5) * 0.3), y: H * 0.42, vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 20 - 8) * dpr,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: (6 + Math.random() * 7) * dpr, h: (4 + Math.random() * 5) * dpr,
    f: farben[i % farben.length], z: i % 9 === 0 ? zeichen[i % zeichen.length] : null, life: 0 }));
  let run = true, t0 = performance.now();
  const frame = (t) => {
    if (!run || !cv.isConnected) return;
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of teile) {
      p.vy += 0.45 * dpr; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      if (p.y > H + 40) continue;
      alive++;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      if (p.z) { ctx.font = `${22 * dpr}px serif`; ctx.fillText(p.z, -11 * dpr, 8 * dpr); }
      else { ctx.fillStyle = p.f; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6))); }
      ctx.restore();
    }
    if (alive && t - t0 < 9000) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  };
  requestAnimationFrame(frame);
  return () => { run = false; };
}
