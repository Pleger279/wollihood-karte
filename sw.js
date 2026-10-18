// Hält die App-Hülle offline bereit und zeigt Push-Meldungen an.
const CACHE = "wollihood-v37";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/badge-96.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: "Wollihood", body: e.data && e.data.text() }; }
  const opts = {
    body: m.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: m.tag || undefined,
    renotify: !!m.tag,
    silent: !!m.silent,
    data: { url: m.url || "./", listing: m.listing_url || null },
  };
  if (m.image) opts.image = m.image;
  if (m.listing_url) opts.actions = [{ action: "open", title: "Inserat öffnen" }];
  // ältere Meldungen: url zeigte direkt aufs Portal
  else if (m.url && /^https?:/.test(m.url) && !m.url.startsWith(self.registration.scope))
    opts.actions = [{ action: "open", title: "Inserat öffnen" }, { action: "app", title: "In der App" }];
  e.waitUntil(self.registration.showNotification(m.title || "Wollihood", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const target = e.action === "open" && d.listing ? d.listing : e.action === "app" ? "./" : d.url || "./";
  const url = new URL(target, self.registration.scope).href;
  e.waitUntil((async () => {
    const own = url.startsWith(self.registration.scope);
    if (own) {
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope)) {
          await w.focus();
          w.postMessage({ type: "deeplink", url });
          return;
        }
      }
    }
    await clients.openWindow(url);
  })());
});
