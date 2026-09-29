PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: 02 (bodies.json), 03 (core/scale.ts), 04 (core/orbital.ts) fertig.

AUFGABE: 3D-Szene — Three.js Szene, Sterne, Planeten, Umlaufbahnen

ERSTELLE GENAU diese Dateien:
1. src/scene/SceneManager.ts
2. src/scene/Starfield.ts
3. src/scene/OrbitLines.ts
4. src/scene/BodyFactory.ts
5. src/scene/types.ts

--- src/scene/types.ts ---
Definiere die Schnittstellen:
  export interface SceneBody {
    id: string; name: string; parent: string | null;
    type: "star" | "planet" | "moon";
    radiusKm: number; semiMajorAxisKm: number;
    eccentricity: number; inclinationDeg: number;
    rotationPeriodH: number; axialTiltDeg: number; color: string;
  }
  export interface SceneOptions { scaleMode: ScaleMode; distanceMode: DistanceMode; }
  export interface SceneStats { bodies: number; drawCalls: number; triangles: number; }
Importiere die Typen aus src/core (NICHT neu definieren).

--- src/scene/SceneManager.ts ---
Klasse SceneManager:
  constructor(canvas: HTMLCanvasElement, options: SceneOptions)
  init(): void
    - WebGLRenderer mit antialias, pixelRatio <= 2
    - PerspectiveCamera, near/far aus constants (wichtig: huge far plane)
    - Scene, schwarzer Hintergrund, ACESFilmicToneMapping
    - HemisphLight fuer Sonnen-Seite, schwaches AmbientLight
    - fügt Sonne + Planeten + Monde hinzu (via BodyFactory)
    - fügt Umlaufbahnlinien hinzu (via OrbitLines)
    - fügt Sternenhimmel hinzu (via Starfield)
    - resize() haengt an window resize
  setTime(julianDate: number): void
    - Berechnet fuer jeden Koerper die Position via orbitalPosition()
    - Setzt mesh.position, rotation (Achsneigung + Rotation)
  setScaleMode(mode: ScaleMode): void
  setDistanceMode(mode: DistanceMode): void
  render(): void
  focusOn(bodyId: string, distanceFactor?: number): void
    - Kamera auf Koerper setzen, smooth
  getStats(): SceneStats
  dispose(): void
    - alle Geometrien/Materialien freigeben, Renderer dispose, Listener loeschen

--- src/scene/Starfield.ts ---
Klasse Starfield:
  constructor(count: number, radius: number, seed?: number)
  - THREE.Points mit richtig verteilten Sternen auf einer Kugel
  - Zufall mit SEED damit das Ergebnis reproduzierbar ist
    (nutze einen einfachen Mulberry32/PRNG, NICHT Math.random)
  - Unterschiedliche Sterngroessen und Helligkeiten
  - Leichte Farbvariation (weiss, leicht blaeulich, leicht gelblich)
  getObject(): THREE.Points

--- src/scene/OrbitLines.ts ---
Klasse OrbitLines:
  constructor(bodies: SceneBody[], sceneScale: DistanceMode)
  - Erzeugt fuer jeden Planeten eine Ellipsen-Linie (THREE.LineLoop)
  - Berechnet Punkte ueber orbitalPosition() fuer einen vollen Umlauf
    (mindestens 180 Segmente fuer weiche Kurven)
  - Fuer Monde: Kreise um den Parent
  - Farbige, halbtransparente Linien
  setVisible(onlyPlanets: boolean): void
  dispose(): void

--- src/scene/BodyFactory.ts ---
Klasse BodyFactory:
  static create(body: SceneBody, scaleMode, distanceMode): THREE.Mesh
  - SphereGeometry mit Segmenten je nach Entfernung (LOD-ish):
    Sonne/naehe Planeten 64 Segmente, entfernte 32
  - Material:
      Sonne: emissiv, orange, ohne Lichtreaktion
      Planeten/Monde: MeshStandardMaterial mit color aus bodies.json
    Noch KEINE Texturen (kommt in einem spaeteren Ticket) — aber die
    Struktur muss vorbereitet sein: eine Funktion static createMaterial(body)
  - Rotiert die Achse um axialTiltDeg
  - Legt die Sonne mit additivem Glüh-Material an
  static dispose(mesh): void

ACCEPTANCE CRITERIA:
- Alle fuenf Dateien unter EXAKTEN Namen
- npx tsc --noEmit: 0 Fehler
- npx vitest run: weiterhin ALLES gruen (keine Regression)
- Starfield nutzt einen deterministischen PRNG (grep: kein Math.random)
- Zeige am Ende die echte Ausgabe von npx tsc --noEmit

WICHTIG:
- KEIN git commit
- src/main.ts in diesem Ticket NICHT umbauen. Nur die scene/-Dateien.
- Jede Klasse mit Docstring, jede oeffentliche Methode erklaert
- Kein Memory-Leak: dispose() muss Geometrie UND Material freigeben
