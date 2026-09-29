PROJEKT: SolarExplorer (siehe /home/cb/Projects/SolarExplorer/AGENTS.md)
REPO-PFAD: /home/cb/Projects/SolarExplorer

VORAUSSETZUNG: Ticket 01 (Fundament) und 03 (core/scale.ts) fertig.

AUFGABE: Umlaufbahnen und Zeitberechnung — echte Kepler-Bahnen

WICHTIG: KEIN Three.js in src/core/. Reine Mathematik, testbar.

ERSTELLE GENAU diese Dateien:
1. src/core/orbital.ts
2. src/core/orbital.test.ts

--- src/core/orbital.ts ---
Definiere und exportiere:

  export interface Vec3 { x: number; y: number; z: number }

  export interface Body {
    id: string;
    parent: string | null;
    semiMajorAxisKm: number;
    eccentricity: number;
    inclinationDeg: number;
    rotationPeriodH: number;
  }

  export interface OrbitalState {
    position: Vec3;      // Position relativ zum Parent, in km
    velocity: Vec3;      // Geschwindigkeit relativ zum Parent, in km/s
    trueAnomalyDeg: number;
    distanceKm: number;  // Abstand zum Parent
  }

  export function meanAnomalyToTrue(M_deg: number, e: number): number
    Loest Keplers Gleichung M = E - e*sin(E) iterativ
    (Newton-Verfahren, Startwert M, max 50 Iterationen, Toleranz 1e-10).

  export function orbitalPosition(
    elements: Body, julianDate: number
  ): OrbitalState
    - Wandelt die Bahnelemente in eine 3D-Position um (elliptische Bahn,
      inkl. Exzentrizitaet und Inklination)
    - Nutzt eine vereinfachte, aber physikalisch korrekte Annahme:
      konstante Schweremasse des Elternkoerpers,方位winkel ueber die
     JD/J2000-Epoche aus der Rotation abgeleitet
    - Rueckgabe in km. docstring mit den Annahmen

  export function julianDateFromUnix(ms: number): number
    JD = ms / 86400000 + 2440587.5

  export function unixFromJulianDate(jd: number): number

  export function getScaleModeFromUrl(search: string): ScaleMode
    Liest ?scale=visual|real|compact aus einem Query-String.
    Default "visual", unbekannt -> Default.

  export function vecs(a: Vec3, b: Vec3): Vec3          // Subtraktion
  export function vecLen(v: Vec3): number                // Laenge
  export function vecNormalize(v: Vec3): Vec3            // Normierung, wirft bei Laenge 0
  export function keplerOrbitalPeriodDays(a: number, e: number): number
    Keplers 3. Gesetz, Periodenlaenge in Tagen

Alle Funktionen mit Docstring + @param/@returns.
Wirf bei NaN/negativen physikalisch unmoeglichen Eingaben klare Fehler
(RangeError mit verstaendlicher Nachricht).

--- src/core/orbital.test.ts ---
Vitest. Mindestens 20 Tests:
  meanAnomalyToTrue:
    - e=0 liefert M zurueck
    - e=0.5, M=0 -> 0
    - e=0.5, M=90 -> > 90 (perigee erreicht)
    - e=0.9: Wert liegt zwischen 0 und 360 fuer M in [0,360)
    - Konvergiert fuer randnahe e=0.99
  julianDate:
    - J2000 (946728000000 ms) -> JD 2451545.0
    - Roundtrip julianDateFromUnix(unixFromJulianDate(jd)) ≈ jd
  orbitalPosition:
    - Erde: semiMajorAxis ~1 AE, eccentricity ~0.0167
      -> distanceKm liegt zwischen 0.98 und 1.02 AE
    - Position aendert sich mit der Zeit
    - eccentricity 0 -> konstante Distanz
    - inclination 0 -> y/z liegen in der Ebene
  vecs/vecLen/vecNormalize: korrekt, vecNormalize(0,0,0) wirft
  keplerOrbitalPeriodDays: Erde ergibt ~365.25 Tage (Toleranz 1%)
  Edge cases: NaN, negative semiMajorAxis, eccentricity > 1 -> RangeError
  getScaleModeFromUrl: "?scale=real" -> "real", "?foo=1" -> "visual",
    "?scale=quatsch" -> "visual", "" -> "visual"
  it.each fuer tabellengetriebene Faelle.

ACCEPTANCE CRITERIA:
- Beide Dateien unter EXAKTEN Namen
- npx tsc --noEmit: 0 Fehler
- npx vitest run src/core/orbital.test.ts: ALLES gruen, >= 20 Tests,
  zeige die ECHTE Ausgabe inkl. Testanzahl
- KEIN "three"-Import in orbital.ts (selbst mit grep pruefen)
- Der Kepler-Test mit e=0.99 konvergiert (nicht in Endlosschleife)

WICHTIG:
- KEIN git commit
- Formeln mit Docstrings erklaeren
- Die Bahn muss eine Ellipse sein, kein Kreis — testbar ueber eccentricity
