AUFGABE: GitHub-Repository anlegen und den SolarExplorer-Stand pushen.

UMGEBUNG (bereits geprüft und vorbereitet):
- Repo-Pfad: /home/cb/Projects/SolarExplorer
- Branch: main, EIN Commit c36dfbf, Arbeitsverzeichnis ist sauber
- 129 Dateien committed. Nichts committet worden ist _probe/, .cache/, node_modules/, dist/
- `gh` CLI ist auf diesem System vorhanden, aber NICHT angemeldet.
- Globaler Git-Nutzer: Christoph Baake <christoph.baake@googlemail.com>

DEINE AUFGABE:
1. Melde dich bei GitHub an. Nutze `gh auth login`. Falls ein Browser-Flow
   noetig ist:fuehre ihn aus und warte auf die Bestaetigung. Der Nutzer
   Christoph Baake ist der Account.
2. Lege das Repository an. Vorgaben:
   - Name: solarexplorer
   -beschreibung: "Interaktive 3D-Darstellung des Sonnensystems fuer Kinder
     mit Raumschiff, Datenpanel und Quiz. Laeuft in Docker."
   - Visibility: public
   - KEIN README-Initialisierung (-), das existiert bereits lokal
   - KEINE .gitignore anlegen (-), die existiert bereits
   Command: gh repo create solarexplorer --public --description "..." --source=. --remote=origin --push
   Falls der Name belegt ist: nimm "solarexplorer-app" und sage es im Bericht.
3. Verifiziere den Push:
   - git remote -v
   - git status (sauber?)
   - git log --oneline -1
   - gh repo view --json name,url,visibility
4. Pruefe die oeffentliche URL tatsaechlich:
   - curl -sI <repo-url> | head -1
   - Der Inhalt sollte das README mit dem Screenshot zeigen.

WICHTIG:
- Aendere KEINEN Code. Du machst ausschliesslich: gh auth, repo create, push.
- Wenn `gh auth login` scheitert oder ein Token fehlt, STOPPE und berichte
  exakt welche Meldung kam. Erfinde kein Token und rate nicht.
- Wenn der Push fehlschlaegt, berichte die echte Fehlermeldung.
- Berichte am Ende: Repo-URL, Sichtbarkeit, ob der Commit angekommen ist,
  und ob die Seite erreichbar ist.

Denk nach, bevor du handelst, und führe dann aus.
