# wollihood-karte

Web-App von Wollihood (öffentliches Repo – keine persönlichen Daten hier ablegen).
Das vollständige Handbuch steht in `CLAUDE.md` im privaten Repo `Pleger279/Wollihood`; dort auch der
Testbrowser (`tools/apptest`).

Aufbau seit v97: `index.html` (Gerüst), `css/app.css`, `js/*.js` (klassische Skripte, Reihenfolge wie in index.html).
Bei jedem Release die Version überall gleich setzen: im privaten Repo `python tools/app_release.py <Nr>`
(setzt `APP_VERSION`, `?v=` aller js/css, `CACHE` und `SHELL` in `sw.js`).
`sw.js` nie im selben Ausdruck lesen und überschreiben. Der Workflow «App-Check» prüft das bei jedem Push.
