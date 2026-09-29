PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: 06 (Szene), 07 (Schiff), 08 (UI) alle fertig.

AUFGABE: Integration — alles zusammenbauen in src/main.ts

AENDERE GENAU diese Datei:
- src/main.ts

Und ERSTELLE:
- src/app.ts   (die Integrationslogik, damit main.ts duenn bleibt)

--- src/app.ts ---
Klasse SolarExplorerApp:
  constructor(canvas: HTMLCanvasElement)
  async start(): Promise<void>
    Ablauf, in dieser Reihenfolge:
    1. bodies.json und facts.json per fetch laden (Promise.all, parallel)
    2. Fehlerbehandlung: wenn Daten nicht geladen werden, zeige eine
       freundliche deutsche Fehlermeldung im DOM, NICHT eine leere Seite
       und KEIN console-only-Fehler
    3. ScaleMode/DistanceMode aus der URL lesen (core/orbital.ts)
    4. SceneManager initialisieren
    5. Ship, ShipControls, CameraFollow erzeugen und verbinden
    6. Nav, Hud, InfoPanel, Quiz erzeugen und mounten
    7. Resize-Handler
  private tick(deltaSeconds: number): void
    - Zeit vorruecken (deltaSeconds * timeScale)
    - scene.setTime() / ship-Update / controls.update() / camera.update()
    - HUD aktualisieren
  startLoop(): void
    - requestAnimationFrame mit deltaSeconds (max. 100ms gedeckelt, damit
      ein Tab-Wechsel nicht springt)
  focusBody(id: string): void
  togglePause(): void
  setScaleMode(mode: ScaleMode): void
  setTimeScale(p: TimePreset): void
  dispose(): void
    - sauberes Abbauen aller Komponenten

--- src/main.ts ---
Soll duenn bleiben:
- Liest den <canvas id="scene"> aus dem DOM
- Instanziiert SolarExplorerApp
- startet sie
- Registriert beforeunload -> app.dispose()
- Fehlerbehandlung: app.start() ablehnen -> Fehlermeldung anzeigen
- KEIN Logik-Ballast hier, nur Bootstrap

ACCEPTANCE CRITERIA:
- src/main.ts ist kuerzer als 40 Zeilen
- src/app.ts hat die Klasse SolarExplorerApp mit allen oben genannten Methoden
- npx tsc --noEmit: 0 Fehler
- npx vitest run: alles gruen
- grep in src/main.ts nach "new SceneManager" oder aehnlichem: die
  Verdrahtung liegt in app.ts, nicht in main.ts

WICHTIG:
- KEIN git commit
- Aendere KEINE anderen Dateien. Wenn dir ein Fehler in einer anderen Datei
  auffaellt, melde ihn im Bericht, aber fass sie nicht an.
- Zeige am Ende die echte Ausgabe von npx tsc --noEmit und npx vitest run
