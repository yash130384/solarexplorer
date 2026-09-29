# SolarExplorer — Projektkontext

Interaktive 3D-Darstellung des Sonnensystems im Browser, mit kindgerechter
Datenexploration und einem steuerbaren Raumschiff. Läuft in Docker.

## Zielgruppe

Kinder ca. 8–14 Jahre. Jede Anzeige muss mindestens eine **verständliche
Erklärung in Kindersprache (Deutsch)** enthalten — nicht nur Zahlen. Technische
Werte (Radius, Masse, Temperatur) sind ergänzend, nie der Hauptinhalt.

## Technischer Stack (NICHT verhandelbar)

| Bereich | Wahl | Begründung |
|---|---|---|
| Build | **Vite** | schnell, Standard für moderne Web-Apps |
| Sprache | **TypeScript** (strict) | Typsicherheit bei viel Geometrie-Mathematik |
| 3D | **Three.js** | Industriestandard für WebGL |
| UI | Vanilla-DOM/CSS | Kein Framework — vermeidet Overhead und Build-Komplexität |
| Daten | **JSON-Dateien** im Repo, statisch ausgeliefert | Kein Backend nötig; Planetenwissen ist statisch |
| Server | **nginx** (alpine) im Container | Statische Auslieferung, klein |
| Test | **Vitest** (Logik) + **Playwright** (E2E/Smoke) | Beides ist npm-nativ |
| Container | Docker + Compose, Port **8090** | 3000/8000 sind auf dem Host belegt |

## Projektstruktur

```
SolarExplorer/
├── src/
│   ├── main.ts                 Einstieg, App-Bootstrap
│   ├── core/                   Framework-unabhängige Logik (testbar!)
│   │   ├── orbital.ts          Umlaufbahnen, Kepler, Positionen
│   │   ├── time.ts             Zeit-Simulation, Skalierung
│   │   └── scale.ts            Größen-/Distanz-Skalierung
│   ├── data/
│   │   ├── bodies.json         Planeten, Monde, Sonne
│   │   └── facts.json          Kindtexte, Vergleiche, Quizfragen
│   ├── scene/                  Three.js-spezifisch
│   │   ├── SceneManager.ts
│   │   ├── BodyFactory.ts      Planeten/Monde erzeugen
│   │   ├── OrbitLines.ts
│   │   ├── Starfield.ts
│   │   └── Ship.ts             Raumschiff-Steuerung
│   ├── ui/
│   │   ├── Hud.ts              Positionsanzeige, Koordinaten
│   │   ├── InfoPanel.ts        Datenpanel je Körper
│   │   ├── Nav.ts              Navigationsmenü
│   │   └── Quiz.ts             Lern-Quiz
│   ├── controls/
│   │   ├── ShipControls.ts     Tastatur/Maus
│   │   └── CameraFollow.ts     Kamera folgt dem Schiff
│   └── assets/
│       └── textures/           Texturen (lokal, kein CDN!)
├── tests/
│   ├── unit/                   Vitest
│   └── e2e/                    Playwright
├── public/
├── Dockerfile
├── docker-compose.yml
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Coding-Standards (verbindlich)

- **TypeScript strict** — kein `any`, keine impliziten Typen
- **Core-Logik ist rein** — `src/core/*` darf NICHT Three.js importieren.
  Nur reine Mathematik. Das macht sie ohne WebGL testbar und ist die Basis für
  verlässliche Tests.
- **Ein Konzept pro Datei**, klare Verantwortung
- **Keine Magic Numbers** — physikalische Konstanten in `src/core/constants.ts`
- **Deutsche UI-Texte**, englische Code-Bezeichner
- **Barrierefreiheit**: Tastaturbedienung, Kontrast, `prefers-reduced-motion`
- Jede öffentliche Funktion: **Docstring** mit `@param`/`@returns`
- **Keine Commits ohne Review-Clearance** (siehe Kanban-Pipeline)

## Physikalische Grundlagen

- **Realistische Größenverhältnisse sind unbrauchbar** (Jupiter ist 11× Erdradius,
  Neptun 30× Erdradius weiter draußen). Deshalb zwei Skalierungsmodi:
  - `visual` (Standard): logarithmische Größen-Skalierung, damit alles sichtbar
  - `real`: echte Verhältnisse, für den Wow-Effekt bei Einzelobjekten
- Umlaufbahnen: **echte Kepler-Bahnen** über J2000-Elemente, nicht Kreise
- Rotationsachsen geneigt (23,4° Erde), Retrograde Rotation (Venus, Uranus)
- Jeder Körper hat **ein/einige dominante Textur** + optional Normal-Map

## Acceptance-Kriterien fürs Gesamtprojekt

- [ ] `docker compose up --build` startet die App auf Port 8090
- [ ] Alle 8 Planeten + Sonne + mindestens 8 Monde sichtbar
- [ ] Jeder Körper zeigt Daten **und** einen Kindtext
- [ ] Raumschiff steuerbar (WASD/Pfeile), Kamera folgt
- [ ] Umlaufbahnen animiert, Zeitraffer/-lupe funktioniert
- [ ] Mindestens 3 Größen-Skalierungsmodi umschaltbar
- [ ] Mindestens 10 Quizfragen mit Feedback
- [ ] Unit-Tests für `src/core/*` laufen grün
- [ ] E2E-Smoke-Test: App lädt, Planeten sind im DOM/Canvas
- [ ] Texturen lokal im Repo, **keine Laufzeit-CDN-Abhängigkeit**
- [ ] Läuft auf Mobil/Tablet (Responsive)
