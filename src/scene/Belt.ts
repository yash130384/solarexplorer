/**
 * Asteroidenguertel und Kometen.
 *
 * Der Guertel zwischen Mars und Jupiter (2,1 - 3,3 AE) besteht aus tausenden
 * kleinen Koerpern. Als einzelne Meshes waere das ein Draw-Call pro Asteroid —
 * bei >= 3000 Stueck absolut unbrauchbar. Deshalb wird der gesamte Guertel als
 * **ein** `THREE.InstancedMesh` gezeichnet: 1 Draw-Call, egal wie viele
 * Asteroiden.
 *
 * Determinismus: Positionen, Groessen und Bahnen kommen aus einem Mulberry32
 * mit festem Seed ({@link BELT_SEED}). `Math.random()` ist hier bewusst
 * verboten — bei zwei Aufrufen muss die Szene identisch aussehen, sonst sind
 * Screenshots und E2E-Tests unbrauchbar.
 *
 * Die Kometen (2 - 3 Stueck) liegen auf stark exzentrischen Bahnen
 * (e >= 0,9) und werden als einzelne kleine Meshes gezeichnet, weil sie von
 * der Kindtext-Navigation erfasst werden.
 *
 * @module scene/Belt
 */

import * as THREE from "three";
import { AU_KM } from "../core/constants";
import { orbitalPosition } from "../core/orbital";
import type { Body } from "../core/orbital";
import { scaleDistance } from "../core/scale";
import type { DistanceMode } from "../core/scale";
import { mulberry32 } from "./Starfield";
import { getSphereGeometry } from "./LodCache";

/** Fester Seed des Asteroiden-P_rng (Mulberry32). */
export const BELT_SEED = 0x4be1_7a5;

/** Standardanzahl der Asteroiden im Guertel. */
export const DEFAULT_ASTEROID_COUNT = 3000;

/** Innere Grenze des Guertels in AE (2,1 AE, typisch fuer die inneren Bahnen). */
export const BELT_INNER_AU = 2.1;

/** Aeussere Grenze des Guertels in AE (3,3 AE, Kirkwood-Luecke/Jupiter). */
export const BELT_OUTER_AU = 3.3;

/** Kleinster Asteroidenradius in Szeneneinheiten. */
const MIN_ASTEROID_SIZE = 0.03;

/** Groesster Asteroidenradius in Szeneneinheiten. */
const MAX_ASTEROID_SIZE = 0.14;

/** Exzentrizitaet der Asteroidenbahnen (leicht elliptisch, wie in echt). */
const ASTEROID_ECCENTRICITY = 0.12;

/** Bahneigung der Asteroiden in Grad (Guertel ist "flach", +/-10 Grad). */
const ASTEROID_INCLINATION_DEG = 10;

/** Farbe der Asteroiden (grau-braun). */
const ASTEROID_COLOR = 0x8a8070;

/** Farbe der Kometen (blaeulich-weiss mit Schweif). */
const COMET_COLOR = 0xcfe4ff;

/** Groesse einer Kugel mit Einheitsradius, fuer die Kometen. */
const COMET_RADIUS = 0.2;

/**
 * Geteilte Oktaeder-Geometrie der Asteroiden (Einheitsradius, 8 Dreiecke).
 *
 * Wird einmal erzeugt und von allen Belt-Instanzen geteilt; `Belt.dispose()`
 * gibt sie bewusst **nicht** frei, weil sie mehrere Guelte gleichzeitig
 * versorgen kann (etwa beim Moduswechsel im HUD).
 */
let sharedAsteroidGeometry: THREE.OctahedronGeometry | null = null;

/**
 * Wiederverwendeter Skalierungsvektor fuer die Instanzmatrizen.
 *
 * `Belt.update` laeuft pro Bild ueber 3000 Asteroiden; ein `new Vector3()`
 * pro Instanz wuerde pro Frame 3000 Objekte erzeugen — genau der
 * GC-Druck, den der LOD-/Instancing-Ansatz vermeiden soll.
 */
const asteroidScale = new THREE.Vector3();

/**
 * Ein Asteroid: Umlaufbahn-Elemente und Groesse, einmal deterministisch
 * erzeugt und dann pro Bild nur noch ausgewertet.
 */
interface Asteroid {
  /** Halbgrosse Achse in Kilometern. */
  readonly semiMajorAxisKm: number;
  /** Exzentrizitaet. */
  readonly eccentricity: number;
  /** Bahneigung in Grad. */
  readonly inclinationDeg: number;
  /** Radius in Szeneneinheiten. */
  readonly radius: number;
  /** Eigenrotation in Grad. */
  readonly spinDeg: number;
  /** Umlaufbahn als `Body` fuer `orbitalPosition` (wiederverwendet). */
  readonly orbit: Body;
}

/** Aggregierte Statistik des Guertels, fuer Konsole und Tests. */
export interface BeltStats {
  /** Anzahl der Asteroiden. */
  readonly asteroids: number;
  /** Anzahl der Kometen. */
  readonly comets: number;
  /** Anzahl der Draw-Calls des Guertels (InstancedMesh = 1, plus Kometen). */
  readonly drawCalls: number;
  /** Dreiecke des Guertels (aus der Instanzgeometrie mal Anzahl). */
  readonly triangles: number;
  /** Innere Grenze in AE. */
  readonly innerAu: number;
  /** Aeussere Grenze in AE. */
  readonly outerAu: number;
}

/**
 * Erzeugt die Umlaufbahn-Elemente aller Asteroiden deterministisch.
 *
 * @param count - Anzahl der Asteroiden (muss > 0 sein).
 * @param seed - Seed des PRNG (Standard {@link BELT_SEED}).
 * @returns Array mit `count` Asteroiden.
 * @throws {RangeError} Wenn `count` keine positive ganze Zahl ist.
 */
export function createAsteroids(count: number, seed: number = BELT_SEED): Asteroid[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`count muss eine positive ganze Zahl sein, ist aber ${String(count)}.`);
  }
  const random = mulberry32(seed);
  const list: Asteroid[] = [];
  for (let i = 0; i < count; i += 1) {
    // Halbachse gleichverteilt zwischen den Guertelgrenzen.
    const au = BELT_INNER_AU + random() * (BELT_OUTER_AU - BELT_INNER_AU);
    const semiMajorAxisKm = au * AU_KM;
    // Exzentrizitaet leicht variierend um ASTEROID_ECCENTRICITY.
    const eccentricity = Math.min(0.35, ASTEROID_ECCENTRICITY + random() * 0.15);
    const inclinationDeg = (random() * 2 - 1) * ASTEROID_INCLINATION_DEG;
    // Radius: die meisten klein, wenige gross (Kuba-S-Gesetz) -> sqrt.
    const radius =
      MIN_ASTEROID_SIZE +
      (MAX_ASTEROID_SIZE - MIN_ASTEROID_SIZE) * Math.sqrt(random());
    const spinDeg = random() * 360;
    list.push({
      semiMajorAxisKm,
      eccentricity,
      inclinationDeg,
      radius,
      spinDeg,
      orbit: {
        id: `asteroid-${i}`,
        parent: "sonne",
        semiMajorAxisKm,
        eccentricity,
        inclinationDeg,
        // Eigenrotation der Asteroids, gleichverteilt (0..24 h).
        rotationPeriodH: 2 + random() * 22,
      },
    });
  }
  return list;
}

/**
 * Berechnet die Position eines Kometen auf seiner stark exzentrischen Bahn.
 *
 * @param comet - Bahn-Elemente des Kometen.
 * @param julianDate - Aktueller Zeitpunkt als Julian Date.
 * @param distanceMode - Distanz-Skalierungsmodus.
 * @returns Weltposition in Szeneneinheiten.
 * @throws {RangeError} Wenn `julianDate` nicht endlich ist.
 */
export function cometPosition(
  comet: Body,
  julianDate: number,
  distanceMode: DistanceMode,
): THREE.Vector3 {
  if (!Number.isFinite(julianDate)) {
    throw new RangeError(
      `julianDate muss eine endliche Zahl sein, ist aber ${String(julianDate)}.`,
    );
  }
  const state = orbitalPosition(comet, julianDate);
  const scaledAxis = scaleDistance(comet.semiMajorAxisKm, distanceMode);
  const factor = scaledAxis / comet.semiMajorAxisKm;
  return new THREE.Vector3(
    state.position.x * factor,
    state.position.y * factor,
    state.position.z * factor,
  );
}

/**
 * Der Asteroidenguertel als einzelnes `InstancedMesh` plus Kometen.
 *
 * Der Asteroidenteil wird aus einem einzigen `InstancedMesh` gezeichnet: die
 * Geometrie ist eine geteilte LOD-Kugel, die Matrix jeder Instanz wird pro
 * Bild aus der Kepler-Bahn berechnet. 3000 Asteroiden = 1 Draw-Call.
 */
export class Belt {
  /** Das `InstancedMesh` des Guertels (1 Draw-Call). */
  private readonly mesh: THREE.InstancedMesh;

  /** Die Kometen als einzelne Meshes. */
  private readonly comets: THREE.Mesh[];

  /** Die Bahnen der Kometen (fuer `orbitalPosition`). */
  private readonly cometOrbits: Body[];

  /** Die Asteroiden (Elemente + Groesse). */
  private readonly asteroids: readonly Asteroid[];

  /** Wiederverwendete Matrix fuer die Instanzen. */
  private readonly matrix = new THREE.Matrix4();

  /** Wiederverwendeter Positions-Vektor. */
  private readonly position = new THREE.Vector3();

  /** Distanz-Skalierungsmodus (wird beim Update gebraucht). */
  private distanceMode: DistanceMode;

  /**
   * Erzeugt den Guertel.
   *
   * @param distanceMode - Distanz-Skalierungsmodus.
   * @param count - Anzahl der Asteroiden (Standard {@link DEFAULT_ASTEROID_COUNT}).
   * @param seed - Seed des PRNG (Standard {@link BELT_SEED}).
   * @throws {RangeError} Wenn `count` keine positive ganze Zahl ist.
   */
  constructor(
    distanceMode: DistanceMode,
    count: number = DEFAULT_ASTEROID_COUNT,
    seed: number = BELT_SEED,
  ) {
    this.distanceMode = distanceMode;
    this.asteroids = createAsteroids(count, seed);

    // Ein geteilter Instanced-Mesh: die Geometrie ist ein **Oktaeder** (8
    // Dreiecke), kein 12x8-Sphaerensegment (192 Dreiecke). Ein Asteroid ist
    // im Bild wenige Pixel gross und unregelmaessig — die kantige Form ist
    // nicht nur 24x guenstiger, sie sieht auch naeher an einem echten
    // Felsbrocken aus als eine glatte Kugel. Bei 3000 Instanzen sind das
    // 24.000 statt 576.000 Dreiecke.
    const geometry = Belt.getAsteroidGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: ASTEROID_COLOR,
      roughness: 1.0,
      metalness: 0.0,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.asteroids.length);
    this.mesh.name = "asteroid-belt";
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Der Guertel bewegt sich im ganzen — Culling wuerde hier nur schaden.
    this.mesh.frustumCulled = false;

    this.cometOrbits = createCometOrbits();
    this.comets = this.cometOrbits.map((orbit) => {
      const cometGeometry = getSphereGeometry("low");
      const cometMaterial = new THREE.MeshStandardMaterial({
        color: COMET_COLOR,
        emissive: COMET_COLOR,
        emissiveIntensity: 0.4,
        roughness: 0.6,
      });
      const comet = new THREE.Mesh(cometGeometry, cometMaterial);
      comet.name = `komet-${orbit.id}`;
      comet.scale.setScalar(COMET_RADIUS);
      return comet;
    });
  }

  /**
   * Aktualisiert alle Positionen (Asteroiden + Kometen) fuer einen Zeitpunkt.
   *
   * Pro Bild werden alle Asteroiden neu positioniert. Bei 3000 Instanzen ist
   * das ~3000 Kepler-Berechnungen — auf einem Desktop unkritisch, auf Mobil
   * ggf. der naechste Optimierungskandidat.
   *
   * @param julianDate - Aktueller Zeitpunkt als Julian Date.
   * @returns {void}
   * @throws {RangeError} Wenn `julianDate` nicht endlich ist.
   */
  update(julianDate: number): void {
    if (!Number.isFinite(julianDate)) {
      throw new RangeError(
        `julianDate muss eine endliche Zahl sein, ist aber ${String(julianDate)}.`,
      );
    }
    for (let i = 0; i < this.asteroids.length; i += 1) {
      const asteroid = this.asteroids[i]!;
      const state = orbitalPosition(asteroid.orbit, julianDate);
      const scaledAxis = scaleDistance(asteroid.semiMajorAxisKm, this.distanceMode);
      const factor = scaledAxis / asteroid.semiMajorAxisKm;
      this.position.set(
        state.position.x * factor,
        state.position.y * factor,
        state.position.z * factor,
      );
      // Rotation zuerst, dann Skalierung: `Matrix4.scale` skaliert die
      // Spalten, das Oktaeder wird also in jeder Instanz unterschiedlich
      // gedreht (sonst faellt das Raster der 3000 Felsen als Gitter auf).
      // `asteroidScale` ist wiederverwendet — ein `new Vector3()` pro
      // Asteroid und Bild waeren 3000 Objekte pro Frame.
      this.matrix.makeRotationY(asteroid.spinDeg);
      this.matrix.scale(asteroidScale.setScalar(asteroid.radius));
      this.matrix.setPosition(this.position);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    // Kometen positionieren.
    for (let i = 0; i < this.comets.length; i += 1) {
      const orbit = this.cometOrbits[i]!;
      const comet = this.comets[i]!;
      comet.position.copy(cometPosition(orbit, julianDate, this.distanceMode));
    }
  }

  /**
   * Liefert die geteilte Oktaeder-Geometrie der Asteroiden.
   *
   * Ein `THREE.OctahedronGeometry(1)` hat 8 Dreiecke — 24x weniger als die
   * kleinste LOD-Kugel (12x8 Segmente = 192 Dreiecke). Da jeder Asteroid im
   * Bild nur wenige Pixel gross ist, faellt der Unterschied nicht auf, und
   * die kantige Form passt besser zu einem Felsbrocken als eine Kugel.
   *
   * @returns Die (immer gleiche) Oktaeder-Geometrie mit Einheitsradius.
   */
  static getAsteroidGeometry(): THREE.OctahedronGeometry {
    if (sharedAsteroidGeometry === null) {
      sharedAsteroidGeometry = new THREE.OctahedronGeometry(1, 0);
      sharedAsteroidGeometry.name = "asteroid-octahedron";
    }
    return sharedAsteroidGeometry;
  }

  /**
   * Liefert eine kompakte Beschreibung der ersten `count` Asteroiden.
   *
   * Enthaelt Bahnelemente und Groessen der ersten Instanzen in fester
   * Reihenfolge. Damit laesst sich im Determinismus-Test belegen, dass der
   * Seed des PRNG stimmt: Ein Wechsel auf `Math.random()` wuerde hier
   * sofort auffallen.
   *
   * @param count - Anzahl der beschriebenen Asteroiden (Standard 8).
   * @returns Komma-getrennte Beschreibung.
   */
  sampleSnapshot(count: number = 8): string {
    const parts: string[] = [];
    for (let i = 0; i < Math.min(count, this.asteroids.length); i += 1) {
      const a = this.asteroids[i]!;
      parts.push(
        `${a.semiMajorAxisKm.toFixed(1)}/${a.eccentricity.toFixed(3)}/` +
          `${a.inclinationDeg.toFixed(2)}/${a.radius.toFixed(4)}/${a.spinDeg.toFixed(2)}`,
      );
    }
    return parts.join(" ");
  }

  /**
   * Wechselt den Distanz-Skalierungsmodus des Guertels.
   *
   * @param distanceMode - Neuer Modus.
   * @returns {void}
   */
  setDistanceMode(distanceMode: DistanceMode): void {
    this.distanceMode = distanceMode;
  }

  /**
   * Liefert das `InstancedMesh` des Guertels und die Kometen-Meshes zum
   * Einhaengen in die Szene.
   *
   * @returns Eine `THREE.Group` mit Guertel + Kometen.
   */
  getObject(): THREE.Group {
    const group = new THREE.Group();
    group.name = "Belt";
    group.add(this.mesh, ...this.comets);
    return group;
  }

  /**
   * Liefert die Statistik des Guertels (fuer Konsole, HUD und E2E-Tests).
   *
   * @returns Anzahl Asteroiden/Kometen, Draw-Calls und Dreiecke.
   */
  getStats(): BeltStats {
    // InstancedMesh: 1 Draw-Call. Kometen: je 1. Dreiecke: das geteilte
    // Oktaeder hat 8 Dreiecke, mal Instanzen.
    const trisPerAsteroid = 8;
    return {
      asteroids: this.asteroids.length,
      comets: this.comets.length,
      drawCalls: 1 + this.comets.length,
      triangles: this.asteroids.length * trisPerAsteroid,
      innerAu: BELT_INNER_AU,
      outerAu: BELT_OUTER_AU,
    };
  }

  /**
   * Loest Geometrien (geteilt -> nicht) und Materialien frei.
   *
   * @returns {void}
   */
  dispose(): void {
    const material = this.mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else {
      material.dispose();
    }
    this.mesh.removeFromParent();
    for (const comet of this.comets) {
      const cometMaterial = comet.material;
      if (Array.isArray(cometMaterial)) {
        for (const entry of cometMaterial) {
          entry.dispose();
        }
      } else {
        cometMaterial.dispose();
      }
      comet.removeFromParent();
    }
    this.comets.length = 0;
  }
}

/**
 * Erzeugt die Bahnen der Kometen.
 *
 * Exportiert (nicht nur intern), damit Tests die Exzentrizitaeten pruefen
 * koennen, ohne die Szene zu rendern.
 *
 * Drei Kometen auf stark exzentrischen Bahnen (alle e >= 0,9): Halbachse
 * zwischen einer kurzperiodischen (4,1 AE) und einer weit gestreckten
 * (17,8 AE), damit die Kinder sowohl einen "schnellen" als auch einen
 * "langsamen" Kometen sehen.
 *
 * @returns Array von drei Kometenbahnen.
 */
export function createCometOrbits(): Body[] {
  return [
    {
      id: "halley",
      parent: "sonne",
      semiMajorAxisKm: 17.8 * AU_KM,
      eccentricity: 0.967,
      inclinationDeg: 162.0,
      rotationPeriodH: 52,
    },
    {
      id: "enne",
      parent: "sonne",
      semiMajorAxisKm: 4.1 * AU_KM,
      eccentricity: 0.91,
      inclinationDeg: 9.0,
      rotationPeriodH: 60,
    },
    {
      id: "schwab",
      parent: "sonne",
      semiMajorAxisKm: 5.5 * AU_KM,
      eccentricity: 0.92,
      inclinationDeg: 30.0,
      rotationPeriodH: 48,
    },
  ];
}
