/**
 * Gemeinsame Schnittstellen der 3D-Szene.
 *
 * Diese Datei enthaelt bewusst **nur** Typen und einen kleinen Loader fuer
 * `src/data/bodies.json`. Sie importiert die Skalierungsmodi aus `src/core`
 * und definiert sie **nicht** neu — `src/core/*` bleibt die einzige Quelle
 * der Wahrheit fuer `ScaleMode` und `DistanceMode`.
 *
 * @module scene/types
 */

import { scaleRadius } from "../core/scale";
import type { DistanceMode, ScaleMode } from "../core/scale";
import bodiesData from "../data/bodies.json";

/** Re-exportiert, damit Konsumenten nur `scene/types` importieren muessen. */
export type { DistanceMode, ScaleMode };

/**
 * Kleinster Radius in Szeneneinheiten, der fuer einen Koerper verwendet wird.
 *
 * Hintergrund: `bodies.json` enthaelt aktuell mindestens einen Koerper
 * (`saturn-s2009s2`) mit `radiusKm: 0.0`, weil die Groesse astronomisch nicht
 * bekannt ist. `scaleRadius` wirft bei 0 — ohne diese Klausel wuerde die
 * gesamte Szene nicht starten. Statt die Daten zu erfinden, wird ein
 * Koerper mit unbekannter Groesse auf einen minimalen Punkt gesetzt, der
 * im "Nur bekannte"-Modus ohnehin ausgeblendet wird.
 */
const MIN_RENDER_RADIUS = 0.01;

/**
 * Ein Himmelskoerper, wie er in der Szene gebraucht wird.
 *
 * Das ist eine bewusste Teilmenge von `bodies.json`: die Szene braucht nur
 * Position, Groesse, Farbe und Rotation, keine Massen oder Temperaturen.
 */
export interface SceneBody {
  /** Stabile Kennung, z. B. `"erde"`. */
  id: string;
  /** Deutscher Anzeigename, z. B. `"Erde"`. */
  name: string;
  /** Kennung des Elternkoerpers, `null` fuer die Sonne. */
  parent: string | null;
  /** Kategorie des Koerpers. */
  type: "star" | "planet" | "moon";
  /** Realer Radius in Kilometern. */
  radiusKm: number;
  /** Grosse Halbachse der Umlaufbahn in Kilometern (0 fuer die Sonne). */
  semiMajorAxisKm: number;
  /** Exzentrizitaet der Umlaufbahn, `0` = Kreis. */
  eccentricity: number;
  /** Neigung der Umlaufbahn in Grad. */
  inclinationDeg: number;
  /** Siderische Rotationsdauer in Stunden (negativ = retrograd). */
  rotationPeriodH: number;
  /** Neigung der Rotationsachse in Grad (z. B. 23,44 fuer die Erde). */
  axialTiltDeg: number;
  /** CSS-Hexfarbe des Koerpers, z. B. `"#2E6FCE"`. */
  color: string;
}

/** Optionen, mit denen eine {@link SceneBody}-Szene aufgebaut wird. */
export interface SceneOptions {
  /** Modus der Radius-Skalierung. */
  scaleMode: ScaleMode;
  /** Modus der Distanz-Skalierung. */
  distanceMode: DistanceMode;
  /** Sonnen-Glanz (Bloom); `auto` richtet sich nach der Hardware. */
  bloomMode?: BloomMode;
  /**
   * Oberflaechen-Texturen der Koerper; `false` laesst sie einfarbig.
   *
   * Nicht fuer den Normalbetrieb gedacht, sondern als **Messschalter**:
   * nur so laesst sich am selben Bild beweisen, dass die Textur wirklich
   * etwas aendert — Kamera und Simulationszeit stehen dabei still, es
   * vergleicht A/B statt zweier Fenster (siehe `tests/e2e/texture-pixels`).
   */
  textures?: boolean;
}

/**
 * Wie der Sonnen-Glanz gesteuert wird.
 *
 * - `auto`: folgt der erkannten Qualitaetsstufe (auf Software-Rasterisierern
 *   aus, weil der Bloom dort die Fuellrate kostet).
 * - `on`: Bloom immer, auch ohne GPU.
 * - `off`: nie.
 */
export type BloomMode = "auto" | "on" | "off";

/** Laufzeitstatistik der Szene, gemessen am Renderer. */
export interface SceneStats {
  /** Anzahl der in der Szene platzierten Koerper (inkl. instanzierter). */
  bodies: number;
  /** Zeichenaufrufe des letzten Render-Durchlaufs. */
  drawCalls: number;
  /** Dreiecke des letzten Render-Durchlaufs. */
  triangles: number;
  /** Anzahl der ueber Instancing gezeichneten kleinen Monde. */
  instancedMoons?: number;
  /** Anzahl der Asteroiden im Guertel. */
  asteroids?: number;
  /** Anzahl der Ringsysteme. */
  rings?: number;
  /** Anzahl der Koerper-Meshes mit geladener Oberflaechen-Textur. */
  textured?: number;
}

/**
 * Helligkeitsmessung eines Bildausschnitts, in Rec.709-Luminanz 0..255.
 *
 * Wird aus dem Backbuffer **waehrend** des Renderframes gelesen (nicht
 * danach): ohne `preserveDrawingBuffer` ist der Backbuffer nach dem
 * Compositing nicht mehr auslesbar.
 */
export interface FrameSample {
  /** Groesste Luminanz im Ausschnitt. */
  maxLuminance: number;
  /** Mittlere Luminanz im Ausschnitt. */
  meanLuminance: number;
  /** Anzahl Pixel mit Luminanz >= {@link BRIGHT_LUMINANCE}. */
  brightPixels: number;
  /** Anzahl Pixel mit Luminanz >= {@link CORE_LUMINANCE}. */
  corePixels: number;
  /** Anzahl gemessener Pixel insgesamt. */
  totalPixels: number;
}

/**
 * Luminanz, ab der ein Pixel als hell gilt.
 *
 * Das ist bewusst kein exakter Wert, sondern eine Schwelle mit Abstand zur
 * Umgebung: Weltraum ist 0, der Korpus der Sonne nach dem Tonemapping fast
 * 255.
 *
 * **Wichtig:** Der Wert zaehlt *keinen* Glanz, sondern nur "hell gegen den
 * Weltraum". Auch der Asteroidenguertel (Albedo-L 0.32, 3000 Instanzen) und
 * die Sterne liegen darueber. Der Nachweis des Glanzes ist deshalb der
 * **Vergleich** zweier Messungen (`bloom=on` gegen `bloom=off`), nicht ein
 * Schwellenwert an sich — siehe `tests/e2e/sun-glow.spec.ts`.
 */
export const BRIGHT_LUMINANCE = 25;

/**
 * Luminanz, ab der ein Pixel als gluehender Kern gilt.
 *
 * Nur die Sonne erreicht nach dem Tone-Mapping diesen Wert; der Guertel
 * nicht. Ueber `bloom=off` gemessen ist das der Korpus allein, mit Bloom
 * der Korpus **plus** Hof.
 */
export const CORE_LUMINANCE = 150;

/** Rechteck eines Bildausschnitts, in CSS-Pixeln ab der linken oberen Ecke. */
export interface FrameRegion {
  /** Abstand vom linken Rand. */
  x: number;
  /** Abstand vom oberen Rand. */
  y: number;
  /** Breite. */
  width: number;
  /** Hoehe. */
  height: number;
}

/**
 * Erzeugt eine Helligkeitsmessung mit Nullwerten.
 *
 * Antwort auf "es wurde gar nicht gemessen": kein Renderer, bereits
 * freigegebene Szene. Damit jeder `await`-Pfad ein Ergebnis bekommt und
 * keiner endlos wartet.
 *
 * @returns Eine neue {@link FrameSample} mit allen Werten 0.
 */
export function emptyFrameSample(): FrameSample {
  return {
    maxLuminance: 0,
    meanLuminance: 0,
    brightPixels: 0,
    corePixels: 0,
    totalPixels: 0,
  };
}

/**
 * Berechnet den Radius eines Koerpers in Szeneneinheiten, ohne zu werfen.
 *
 * Bei unbekannter Groesse (`radiusKm <= 0`) wird {@link MIN_RENDER_RADIUS}
 * verwendet, damit ein einzelner unvollstaendiger Datensatz nicht die ganze
 * Szene lahmlegt.
 *
 * @param body - Der Koerper aus `bodies.json`.
 * @param scaleMode - Radius-Skalierungsmodus.
 * @returns Radius in Szeneneinheiten (immer > 0).
 */
export function safeRenderRadius(body: SceneBody, scaleMode: ScaleMode): number {
  if (!Number.isFinite(body.radiusKm) || body.radiusKm <= 0) {
    return MIN_RENDER_RADIUS;
  }
  const scaled = scaleRadius(body.radiusKm, scaleMode);
  return Number.isFinite(scaled) && scaled > 0 ? scaled : MIN_RENDER_RADIUS;
}

/**
 * Formatiert einen Datensatz aus `bodies.json` als {@link SceneBody}.
 *
 * Wirft bewusst, wenn ein Pflichtfeld fehlt: eine halb geladene Szene waere
 * schlimmer als ein klarer Fehler beim Start.
 *
 * @param raw - Untypisierter Datensatz aus der JSON-Datei.
 * @returns Der normalisierte Szene-Koerper.
 * @throws {TypeError} Wenn ein Pflichtfeld fehlt oder den falschen Typ hat.
 */
function toSceneBody(raw: unknown): SceneBody {
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError("Ein Eintrag aus bodies.json ist kein Objekt.");
  }
  const record = raw as Record<string, unknown>;
  const type = record["type"];
  if (type !== "star" && type !== "planet" && type !== "moon") {
    throw new TypeError(`Unbekannter Koerpertyp: ${String(type)}`);
  }
  const parent = record["parent"];
  if (parent !== null && typeof parent !== "string") {
    throw new TypeError(`parent muss string oder null sein: ${String(parent)}`);
  }

  return {
    id: String(record["id"]),
    name: String(record["name"]),
    parent,
    type,
    radiusKm: Number(record["radiusKm"]),
    semiMajorAxisKm: Number(record["semiMajorAxisKm"]),
    eccentricity: Number(record["eccentricity"]),
    inclinationDeg: Number(record["inclinationDeg"]),
    rotationPeriodH: Number(record["rotationPeriodH"]),
    axialTiltDeg: Number(record["axialTiltDeg"]),
    color: String(record["color"]),
  };
}

/**
 * Laedt alle Koerper aus `bodies.json` in die Szenenrepräsentation.
 *
 * Der Loader haelt hier, damit `SceneManager` laut Spezifikation nur
 * `(canvas, options)` bekommt und trotzdem beim Start Daten hat.
 *
 * @returns Array aller Koerper in der Reihenfolge der Datei.
 * @throws {TypeError} Wenn die Datei oder ein Eintrag das falsche Format hat.
 */
export function loadSceneBodies(): SceneBody[] {
  const container = bodiesData as unknown as { bodies?: unknown };
  const list = container.bodies;
  if (!Array.isArray(list)) {
    throw new TypeError("bodies.json enthaelt kein 'bodies'-Array.");
  }
  return list.map(toSceneBody);
}
