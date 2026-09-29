/**
 * Gemeinsam genutzte Kugel-Geometrien fuer die Detailstufen (Level of Detail).
 *
 * Motivation: bei mehreren hundert Koerpern kostet jede eigene
 * `SphereGeometry` sowohl Speicher als auch Zeichenaufrufe. Deshalb existiert
 * hier **pro Detailstufe genau eine** Einheitskugel, die alle Koerper teilen;
 * die Groesse wird ueber `mesh.scale` gesetzt, nicht ueber den Radius der
 * Geometrie.
 *
 * Wechsel mit Hysterese: die Stufe wechselt erst, wenn die Kamera eine
 * Schwelle deutlich ueberschreitet (Faktor {@link LOD_HYSTERESIS}). Ohne das
 * wuerde ein Koerper im Grenzbereich bei jedem Bild zwischen zwei
 * Geometrien pendeln (Flackern + GC-Druck).
 *
 * @module scene/LodCache
 */

import * as THREE from "three";

/** Die drei Detailstufen, von grob nach fein. */
export type LodLevel = "low" | "medium" | "high";

/** Segmentzahlen (Breite x Hoehe) je Detailstufe. */
export const LOD_SEGMENTS: Readonly<Record<LodLevel, { width: number; height: number }>> = {
  low: { width: 12, height: 8 },
  medium: { width: 24, height: 16 },
  high: { width: 48, height: 32 },
};

/**
 * Faktor, um den eine Schwelle ueberschritten werden muss, damit die Stufe
 * wirklich wechselt (Hysterese). 1.35 bedeutet: 35 % weiter weg nochnal,
 * bevor von `high` auf `medium` geschaltet wird.
 */
export const LOD_HYSTERESIS = 1.35;

/**
 * Vielfaches des Koerperradius, bis zu dem `high` verwendet wird.
 *
 * Alles zwischen `HIGH_FACTOR` und `HIGH_FACTOR * HYSTERESIS` ist `medium`.
 */
const HIGH_FACTOR = 40;

/** Vielfaches des Koerperradius, bis zu dem mindestens `medium` verwendet wird. */
const MEDIUM_FACTOR = 400;

/** Namenspraefix aller geteilten LOD-Geometrien (erkennbar fuer `dispose`). */
export const SHARED_GEOMETRY_PREFIX = "lod-sphere-";

/** Cache der geteilten Einheitskugeln, je Detailstufe genau eine. */
const cache = new Map<LodLevel, THREE.SphereGeometry>();

/**
 * Liefert die gemeinsam genutzte Einheitskugel einer Detailstufe.
 *
 * Die Geometrie wird **einmal** erzeugt und danach immer wiederverwendet.
 * Aufrufer duerfen sie nicht selbst freigeben — dafuer gibt es
 * {@link disposeLodGeometries}.
 *
 * @param level - Gewuenschte Detailstufe.
 * @returns Die (immer gleiche) Kugelgeometrie der Stufe.
 * @throws {RangeError} Wenn `level` unbekannt ist.
 */
export function getSphereGeometry(level: LodLevel): THREE.SphereGeometry {
  const cached = cache.get(level);
  if (cached !== undefined) {
    return cached;
  }
  const segments = LOD_SEGMENTS[level];
  if (segments === undefined) {
    throw new RangeError(`Unbekannte Detailstufe: ${String(level)}`);
  }
  const geometry = new THREE.SphereGeometry(1, segments.width, segments.height);
  geometry.name = `lod-sphere-${level}`;
  cache.set(level, geometry);
  return geometry;
}

/**
 * Bestimmt die Detailstufe fuer eine Kamera-Koerper-Distanz.
 *
 * Die Distanz wird auf den Koerperradius normiert, damit die Stufe unabhaengig
 * von der Groesse des Koerpers und vom Skalierungsmodus gilt.
 *
 * @param distance - Abstand Kamera -> Koerper in Szeneneinheiten.
 * @param radius - Radius des Koerpers in Szeneneinheiten (> 0).
 * @param current - Aktuell gesetzte Stufe (fuer die Hysterese).
 * @returns Die zu verwendende Detailstufe.
 * @throws {RangeError} Wenn `radius` nicht positiv oder `current` unbekannt ist.
 */
export function selectLodLevel(
  distance: number,
  radius: number,
  current: LodLevel,
): LodLevel {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`radius muss positiv sein, ist aber ${String(radius)}.`);
  }
  if (LOD_SEGMENTS[current] === undefined) {
    throw new RangeError(`Unbekannte aktuelle Detailstufe: ${String(current)}`);
  }
  const d = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  const ratio = d / radius;

  // Heraufstufen ist billig, herunterstufen nicht (sichtbarer Wechsel).
  // Deshalb gilt fuer "feiner werden" eine kleinere Schwelle als fuer "grob".
  if (ratio <= HIGH_FACTOR) {
    return "high";
  }
  return ratio <= MEDIUM_FACTOR ? "medium" : "low";
}

/**
 * Bestimmt, ob ein Wechsel der Detailstufe noetig ist, und liefert die neue
 * Stufe. Enthaelt die Hysterese.
 *
 * Regel: **Heraufstufen** (feiner werden) passiert sofort an der Schwelle —
 * ein Kind, das einen Planeten anfliegt, soll ihn auch aus 300 Koerperradius
 * Entfernung scharf sehen. **Herunterstufen** (grob werden) passiert erst,
 * wenn die Distanz die Schwelle um {@link LOD_HYSTERESIS} (35 %) ueberschritten
 * hat. Genau das verhindert das Pendeln: ein Koerper, der auf der Schwelle
 * steht, faellt nur dann auf `medium` zurueck, wenn die Kamera deutlich
 * weiter weg ist — und steigt sofort wieder auf, sobald sie zurueckkommt.
 *
 * @param distance - Abstand Kamera -> Koerper in Szeneneinheiten.
 * @param radius - Radius des Koerpers in Szeneneinheiten.
 * @param current - Aktuell gesetzte Stufe.
 * @returns Die neue Stufe — identisch zu `current`, wenn nichts wechselt.
 * @throws {RangeError} Wenn `radius` nicht positiv oder `current` unbekannt ist.
 */
export function nextLodLevel(
  distance: number,
  radius: number,
  current: LodLevel,
): LodLevel {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`radius muss positiv sein, ist aber ${String(radius)}.`);
  }
  if (LOD_SEGMENTS[current] === undefined) {
    throw new RangeError(`Unbekannte aktuelle Detailstufe: ${String(current)}`);
  }
  const d = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  const ratio = d / radius;
  const target = selectLodLevel(d, radius, current);

  if (target === current) {
    return current;
  }

  // Reihenfolge grob -> fein, damit "feiner" erkennbar ist.
  const order: readonly LodLevel[] = ["low", "medium", "high"];
  const from = order.indexOf(current);
  const to = order.indexOf(target);

  if (to > from) {
    // Heraufstufen: sofort.
    return target;
  }
  // Herunterstufen: nur jenseits der mit Hysterese verlaegerten Schwelle.
  // Die Schwelle ist die Obergrenze der Stufe, *in die* zurueckgestuft
  // wird: high -> medium an der high-Grenze (40), medium -> low an der
  // medium-Grenze (400).
  const upper = target === "medium" ? HIGH_FACTOR : MEDIUM_FACTOR;
  return ratio > upper * LOD_HYSTERESIS ? target : current;
}

/**
 * Haengt einem Mesh die Geometrie einer Detailstufe an und setzt die Groesse.
 *
 * Der Mesh traegt die Radiusinformation in `userData`, damit
 * {@link applyLodToMesh} sie beim Wechsel wiederverwenden kann.
 *
 * @param mesh - Das Mesh, das gesetzt werden soll.
 * @param level - Gewuenschte Detailstufe.
 * @param radius - Radius in Szeneneinheiten (> 0).
 * @returns {void}
 * @throws {RangeError} Wenn `radius` nicht positiv ist.
 */
export function applyLodToMesh(
  mesh: THREE.Mesh,
  level: LodLevel,
  radius: number,
): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError(`radius muss positiv sein, ist aber ${String(radius)}.`);
  }
  mesh.geometry = getSphereGeometry(level);
  mesh.scale.setScalar(radius);
  mesh.userData["lodLevel"] = level;
  mesh.userData["bodyRadius"] = radius;
}

/**
 * Wiederverwendeter Weltpositions-Vektor fuer {@link applyLodByDistance}.
 *
 * Die Funktion laeuft pro Bild und pro Mesh; ohne Scratch-Objekt wuerde
 * das im Renderloop dauernd `Vector3`-Objekte erzeugen.
 */
const worldPosition = new THREE.Vector3();

/**
 * Aktualisiert die Detailstufe eines Mesh anhand der Kameradistanz.
 *
 * Wechselt nur, wenn sich die Stufe tatsaechlich aendert — das vermeidet
 * Flackern und unnötige Arbeit.
 *
 * @param mesh - Das Mesh, dessen Stufe geprueft wird.
 * @param cameraPosition - Weltposition der Kamera.
 * @returns Die jetzt gesetzte Detailstufe.
 * @throws {RangeError} Wenn das Mesh keine gueltige Stufe traegt.
 */
export function applyLodByDistance(
  mesh: THREE.Mesh,
  cameraPosition: THREE.Vector3,
): LodLevel {
  const radius = Number(mesh.userData["bodyRadius"]);
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError("Mesh traegt keine gueltige bodyRadius in userData.");
  }
  const current = mesh.userData["lodLevel"] as LodLevel | undefined;
  if (current === undefined) {
    throw new RangeError("Mesh traegt keine gueltige lodLevel in userData.");
  }
  mesh.getWorldPosition(worldPosition);
  const next = nextLodLevel(worldPosition.distanceTo(cameraPosition), radius, current);
  if (next !== current) {
    mesh.geometry = getSphereGeometry(next);
    mesh.userData["lodLevel"] = next;
  }
  return next;
}

/**
 * Gibt alle gecachten Kugelgeometrien frei und leert den Cache.
 *
 * Muss beim endgueltigen Abbau der Szene aufgerufen werden, damit die
 * geteilten Geometrien nicht undokumentiert im WebGL-Speicher liegen.
 *
 * @returns {void}
 */
export function disposeLodGeometries(): void {
  for (const geometry of cache.values()) {
    geometry.dispose();
  }
  cache.clear();
}

/**
 * Liefert die Anzahl der aktuell gecachten Geometrien (nur fuer Tests/Debug).
 *
 * @returns Anzahl der gecachten Detailstufen.
 */
export function lodCacheSize(): number {
  return cache.size;
}
