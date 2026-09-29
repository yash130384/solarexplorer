/**
 * Sternenhimmel als `THREE.Points`.
 *
 * Die Sternpositionen werden ueber einen deterministischen PRNG (Mulberry32)
 * erzeugt. `Math.random()` ist hier bewusst verboten: der Sternenhimmel soll
 * bei jedem Start identisch aussehen, damit Screenshots und E2E-Tests
 * stabil bleiben.
 *
 * @module scene/Starfield
 */

import * as THREE from "three";

/** Standardanzahl der Sterne im Himmelskugel-Modell. */
export const DEFAULT_STAR_COUNT = 4000;

/** Standardradius der Himmelskugel in Szeneneinheiten. */
export const DEFAULT_STARFIELD_RADIUS = 200_000;

/** Standard-Seed des PRNG (fix, damit das Ergebnis reproduzierbar ist). */
export const DEFAULT_STAR_SEED = 0x5eed_1234;

/**
 * Deterministischer PRNG (Mulberry32).
 *
 * Liefert fuer denselben Startwert immer dieselbe Folge von Zahlen im
 * Intervall `[0, 1)` — die Standardimplementierung nutzt `Math.random()`.
 *
 * @param seed - Startwert des Generators (32 Bit, ganzzahlig).
 * @returns Funktion, die bei jedem Aufruf die naechste Zahl in `[0, 1)` liefert.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Kleinste Sterngroesse in Pixeln. */
const MIN_SIZE = 1.0;

/** Groesste Sterngroesse in Pixeln. */
const MAX_SIZE = 3.2;

/** Kleinste Helligkeit (multipliziert mit der Farbe). */
const MIN_BRIGHTNESS = 0.45;

/** Groesste Helligkeit. */
const MAX_BRIGHTNESS = 1.0;

/**
 * Sternenhimmel auf einer Kugel um die Sonne.
 *
 * Die Verteilung ist gleichverteilt auf der Kugeloberflaeche: der Polarwinkel
 * wird ueber `acos` gleichverteilt, damit die Sterne nicht zu den Polen
 * wandern. Groesse und Farbe variieren leicht (weiss, leicht blaeulich,
 * leicht gelblich), damit es wie ein echter Himmel aussieht und nicht wie ein
 * Raster.
 */
export class Starfield {
  /** Das gerenderte `THREE.Points`-Objekt. */
  private readonly points: THREE.Points;

  /** Radius der Himmelskugel in Szeneneinheiten. */
  private readonly radius: number;

  /** Seed, mit dem der Himmel erzeugt wurde (fuer Reproduzierbarkeit). */
  private readonly seed: number;

  /**
   * Erzeugt einen Sternenhimmel.
   *
   * @param count - Anzahl der Sterne (muss > 0 sein).
   * @param radius - Radius der Himmelskugel in Szeneneinheiten (muss > 0 sein).
   * @param seed - Optionaler Seed des PRNG; Standard ist ein fester Wert,
   *   damit der Himmel ohne Argument immer gleich aussieht.
   * @throws {RangeError} Wenn `count` oder `radius` nicht positiv sind.
   */
  constructor(
    count: number = DEFAULT_STAR_COUNT,
    radius: number = DEFAULT_STARFIELD_RADIUS,
    seed: number = DEFAULT_STAR_SEED,
  ) {
    if (!Number.isFinite(count) || count <= 0) {
      throw new RangeError(`count muss positiv sein, ist aber ${String(count)}.`);
    }
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new RangeError(`radius muss positiv sein, ist aber ${String(radius)}.`);
    }

    this.radius = radius;
    this.seed = seed >>> 0;

    const total = Math.floor(count);
    const random = mulberry32(this.seed);

    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);

    for (let i = 0; i < total; i++) {
      // Gleichverteilung auf der Kugel: u gleichverteilt, cos(theta) = 2u - 1.
      const u = random();
      const v = random();
      const cosTheta = 2 * u - 1;
      const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
      const phi = v * Math.PI * 2;

      const i3 = i * 3;
      positions[i3] = radius * sinTheta * Math.cos(phi);
      positions[i3 + 1] = radius * sinTheta * Math.sin(phi);
      positions[i3 + 2] = radius * cosTheta;

      // Groesse: biased klein, damit ein paar helle "Leuchttuerme" herausstechen.
      const sizeRoll = random();
      const size = MIN_SIZE + (MAX_SIZE - MIN_SIZE) * sizeRoll * sizeRoll;
      sizes[i] = size;

      const brightness =
        MIN_BRIGHTNESS + (MAX_BRIGHTNESS - MIN_BRIGHTNESS) * (0.35 + 0.65 * random());

      // Leichte Farbvariation: weiss, leicht blaeulich, leicht gelblich.
      const tint = random();
      let r = 1;
      let g = 1;
      let b = 1;
      if (tint < 0.2) {
        r = 0.78;
        g = 0.85;
        b = 1.0;
      } else if (tint < 0.4) {
        r = 1.0;
        g = 0.95;
        b = 0.78;
      }

      colors[i3] = r * brightness;
      colors[i3 + 1] = g * brightness;
      colors[i3 + 2] = b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    // Vertexfarben statt Textur: eine einzige Textur (Radialverlauf) reicht,
    // damit Punkte nicht als harte Quadrate erscheinen.
    const material = new THREE.PointsMaterial({
      size: 2.0,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.name = "Starfield";
    this.points.frustumCulled = false;
    this.points.renderOrder = -1;
  }

  /**
   * Liefert das `THREE.Points`-Objekt zum Hinzufuegen zur Szene.
   *
   * @returns Das Punkte-Objekt (nicht die dahinterliegende Instanz).
   */
  getObject(): THREE.Points {
    return this.points;
  }

  /**
   * Liefert den Radius der Himmelskugel.
   *
   * @returns Radius in Szeneneinheiten.
   */
  getRadius(): number {
    return this.radius;
  }

  /**
   * Liefert den verwendeten Seed.
   *
   * @returns Der 32-Bit-Seed des PRNG.
   */
  getSeed(): number {
    return this.seed;
  }

  /**
   * Liefert die Anzahl der erzeugten Sterne.
   *
   * Haengt an der Qualitaetsstufe (siehe `scene/quality`) — der Wert ist
   * deshalb Teil des Determinismus-Snapshots: er muss bei zwei Aufrufen
   * gleich sein, sonst waere der "Himmel" bei jedem Start anders.
   *
   * @returns Anzahl der Sterne.
   */
  getCount(): number {
    return this.points.geometry.getAttribute("position").count;
  }

  /**
   * Gibt Geometrie und Material des Sternenhimmels frei.
   *
   * @returns {void}
   */
  dispose(): void {
    this.points.geometry.dispose();
    const material = this.points.material;
    if (material instanceof THREE.Material) {
      material.dispose();
    }
    this.points.removeFromParent();
  }
}
