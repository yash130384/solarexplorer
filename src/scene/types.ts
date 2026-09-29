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
}

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
