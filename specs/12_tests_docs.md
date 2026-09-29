PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: 01-11 fertig. Docker laeuft auf localhost:8090.

AUFGABE: Tests und Dokumentation — E2E, README, Qualitaets-Gate

ERSTELLE GENAU:
1. playwright.config.ts
2. tests/e2e/smoke.spec.ts
3. tests/e2e/exploration.spec.ts
4. README.md
5. tests/unit/format.test.ts
6. .github/workflows/ci.yml  (optional, aber gut)

--- playwright.config.ts ---
  testDir: "./tests/e2e"
  baseURL: "http://localhost:8090"
  timeout: 30000
  use: {
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  }
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ]
  webServer: {
    command: "docker compose up -d && sleep 8",
    url: "http://localhost:8090",
    reuseExistingServer: true,
    timeout: 120000
  }

--- tests/e2e/smoke.spec.ts ---
Mindestens 5 Tests:
  1. Seite laedt ohne Konsolenfehler
     - Sammle console-Events, filtere "error", erwarte 0
  2. Titel enthaelt "SolarExplorer"
  3. <canvas id="scene"> ist sichtbar und hat Breite/Hoehe > 0
     WICHTIG: pruefe per evaluate() getBoundingClientRect(), NICHT per
     Screenshot — ein Canvas kann 0x0 sein ohne sichtbar zu scheinen
  4. Navigationsliste zeigt mindestens 9 Eintraege (Sonne + 8 Planeten)
  5. Info-Panel oeffnet fuer "Erde" und zeigt den Text "Erde"
     UND den Radius-Wert 6371

--- tests/e2e/exploration.spec.ts ---
Mindestens 4 Tests:
  1. Skalierungsmodus umschalten: URL-Parameter ?scale=real setzen,
     Seite neu laden, pruefen dass die App ohne Fehler startet
  2. Quiz starten: Quiz oeffnen, Frage beantworten, Feedback sichtbar
  3. Tastatursteuerung: Body-Fokus setzen, "w" druecken, pruefen dass
     die Schiffsposition sich aendert (ueber expose() oder ein
     data-Attribut im DOM)
  4. Mobil-Viewport 375x812: Navigation ist bedienbar, kein horizontales
     Scrollen (document.documentElement.scrollWidth <= innerWidth)

--- tests/unit/format.test.ts ---
Vitest-Tests fuer die Kindtext-Formatierung:
  - formatKm erzeugt KEINE Exponenten-Notation fuer grosse Zahlen
    (wichtig: Kinder duerfen kein "1,496e+08 km" sehen)
  - formatDuration mit negativen Werten (retrograde Rotation)
  - Quiz-Validierung: lade facts.json, pruefe dass jede Frage
    correctIndex im Bereich 0..options.length-1 liegt
  - bodies.json-Validierung: jedes body hat die Pflichtfelder,
    und jede parentId existiert wirklich (keine verwaisten Referenzen)

--- README.md ---
Deutsch, fuer den Nutzer (nicht fuer Entwickler):
  - Titel + kurze Beschreibung + ein Screenshot-Abschnitt
  - Was ist das? Fuer wen?
  - Features (mit den echtenfunktionen, nichts versprechen was nicht da ist)
  - Schnellstart:
      docker compose up --build
      Browser: http://localhost:8090
  - Steuerung: Tabelle aller Tasten
  - Der Lernteil: Quiz, Datenpanel, Glossar erklaeren
  - Technischer Aufbau (kurz, fuer Neugierige)
  - Hinweis zu Datenquellen: NASA/JPL als Zahlenbasis, Texturen prozedural
  - Bekannte Einschraenkungen ehrlich aufzaehlen
  - Lizenz-/Datennutzungshinweis
  KEINE erfundenen Features. Wenn etwas nicht implementiert ist, steht es
  nicht in den Features.

ACCEPTANCE CRITERIA:
- npx playwright test: mindestens 7 Tests, zeige die ECHTE Ausgabe
- npx vitest run: alles gruen inkl. der neuen Tests
- README.md nennt nur Features, die im Code existieren
- Der Smoke-Test 3 faengt ein 0x0-Canvas wirklich ab (erklaere wie)
- KEIN git commit
- Am Ende: "docker compose down" ausfuehren und das Ergebnis zeigen

WICHTIG:
- Wenn ein Test fehlschlaegt, BEHANDLE IHN NICHT durch Weglassen oder
  Schwachen. Wenn die App kaputt ist, melde es als Befund — dann ist das
  ein echter Fund, kein Testfehler.
- Zeige alle Ausgaben echt, inkl. Fehlschlaegen.
