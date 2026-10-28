# wollihood-karte

Web-App von Wollihood (öffentliches Repo – keine persönlichen Daten hier ablegen).
Das vollständige Handbuch steht in `CLAUDE.md` im privaten Repo `Pleger279/Wollihood`; dort auch der
Testbrowser (`tools/apptest`).

Bei jedem Release `APP_VERSION` in `index.html` und `CACHE` in `sw.js` auf dieselbe Nummer erhöhen.
`sw.js` nie im selben Ausdruck lesen und überschreiben. Der Workflow «App-Check» prüft das bei jedem Push.
