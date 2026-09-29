PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Ticket 06 (scene/*) fertig.

AUFGABE: Raumschiff — Modell, Steuerung, Kamera-Follow

ERSTELLE GENAU diese Dateien:
1. src/scene/Ship.ts
2. src/controls/ShipControls.ts
3. src/controls/CameraFollow.ts

--- src/scene/Ship.ts ---
Klasse Ship:
  constructor(scaleMode: ScaleMode, distanceMode: DistanceMode)
    - Baut ein kleines, freundliches Raumschiff aus Three.js-Primitiveen:
      Rumpf (CapsuleGeometry), Cockpit (SphereGeometry halb),
      Flügel/Querfelder, Triebwerks-Glow (PointLight oder emissive)
    - Farbkontrast zum Weltraum: helles Blau/Weiss mit orangem Akzent
    - Ursprung zeigt in Flugrichtung (+Z oder -Z, dokumentiere es)
  getObject(): THREE.Group
  getPosition(): Vec3          (aus core/orbital importiert)
  setPosition(v: Vec3): void
  getVelocity(): Vec3
  setVelocity(v: Vec3): void
  getHeadingDeg(): number
  getSpeedKmS(): number
  getThrustLevel(): number      (0..1, fuer HUD)
  rotate(deltaYaw: number, deltaPitch: number): void
    - Yaw um die Hochachse, Pitch um die Querachse
    - Begrenzung des Pitch auf -85..85 Grad, damit das Schiff nicht
      kopfsteht
  thrust(forward: number, strafe: number, up: number): void
    - Beschleunigt in Schiffsrichtung
  dispose(): void

--- src/controls/ShipControls.ts ---
Klasse ShipControls:
  constructor(ship: Ship, camera: CameraFollow)
  attach(element: HTMLElement): void
  detach(): void
  update(deltaSeconds: number): void
  - Tastatur:
      W / Pfeil hoch  : Schub vorwaerts
      S / Pfeil runter: Schub rueckwaerts
      A / D oder Pfeil links/rechts: Schwenken (Yaw)
      Q / E         : Nicken (Pitch)
      Shift         : Turbo (2.5x Schub)
      Space         : Schub stoppen / Halte
      M             : auf Merkur zoomen (Schnellreise)
      F             : auf die Erde fliegen
  - Verhindert, dass die Seite scrollt (preventDefault auf Pfeiltasten)
  - Maus: ziehen = Schwenken der Kamera relativ zum Schiff (optional)
  - Touch: zwei Finger = schieben, ein Finger = schwenken (fuer Tablet)
  - Sauberes Key-Handling: Tastendruck-Status pro Taste, Keyup raeumt auf
  - ESC setzt das Schiff auf eine sichere Position zurueck
  - GIBT KEINE Fehler wenn keydown zweimal kommt (key repeat)

--- src/controls/CameraFollow.ts ---
Klasse CameraFollow:
  constructor(camera: THREE.PerspectiveCamera)
  setTarget(object: THREE.Object3D | null): void
  setMode(mode: "follow" | "free" | "orbit"): void
  setOrbitDistance(d: number): void
  update(deltaSeconds: number): void
    - follow: Kamera hinter dem Schiff, weich nachgezogen (Lerp/smoothing)
    - orbit: automatische Umkreisung um das Ziel
    - free: keine automatische Bewegung
  toggleMode(): void
  dispose(): void
  - Sanfte Uebergaenge, keine harten Spruenge
  - Respektiert prefers-reduced-motion: dann keine Animation

ACCEPTANCE CRITERIA:
- Alle drei Dateien unter EXAKTEN Namen
- npx tsc --noEmit: 0 Fehler
- npx vitest run: weiterhin alles gruen
- Pitch ist auf -85..85 begrenzt (pruefe den Code)
- attach() und detach() sind sauber, kein doppeltes addEventListener
- prefers-reduced-motion wird respektiert (grep im Code)

WICHTIG:
- KEIN git commit
- KEINE Aenderung an src/scene/SceneManager.ts in diesem Ticket
  (das Integration kommt in einem eigenen spaeteren Ticket)
- Vollstaendige JSDoc auf allen oeffentlichen Methoden
