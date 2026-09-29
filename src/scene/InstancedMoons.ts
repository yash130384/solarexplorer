/**
 * Kleine, unbekannte Monde als `THREE.InstancedMesh`.
 *
 * Bei mehreren hundert Koerpern ist die Zahl der Zeichenaufrufe (Draw-Calls)
 * der Engpass — nicht die Dreiecke. Jeder kleine Mond als eigenes Mesh kostet
 * einen Draw-Call. Deshalb werden die kleinen Monde, die nie einzeln angeklickt
 * werden, in **einem** `InstancedMesh` pro Elternkoerper gezeichnet: eine
 * Geometrie, ein Material, ein Draw-Call — unabhaengig von der Anzahl.
 *
 * Die grossen und bekannten Monde (Mond, Io, Europa, Titan, Triton, Phobos,
 * Deimos) bleiben normale Meshes in {@link ../scene/BodyFactory}, weil sie
 * individually navigierbar und mit Textur sein sollen.
 *
 * @module scene/InstancedMoons
 */

import * as THREE from "three";
import { J2000_JULIAN_DATE, orbitalPosition } from "../core/orbital";
import { scaleDistance } from "../core/scale";
import type { DistanceMode, ScaleMode } from "../core/scale";
import { getSphereGeometry } from "./LodCache";
import { safeRenderRadius } from "./types";
import type { SceneBody } from "./types";

/**
 * IDs der Monde, die als einzelnes Mesh gerendert werden.
 *
 * Das sind die grossen bzw. bekannten Monde: sie haben einen Kindtext, eine
 * Textur und werden in der Navigation angeklickt.
 */
export const FEATURED_MOON_IDS: ReadonlySet<string> = new Set([
  "mond",
  "io",
  "europa",
  "titan",
  "triton",
  "phobos",
  "deimos",
]);

/**
 * Entscheidet, ob ein Mond als eigenes Mesh gerendert wird.
 *
 * @param body - Der Koerper aus `bodies.json`.
 * @returns `true` fuer die grossen/bekannten Monde, `false` fuer kleine.
 */
export function isFeaturedMoon(body: SceneBody): boolean {
  return body.type === "moon" && FEATURED_MOON_IDS.has(body.id);
}

/**
 * Detailstufen der **instanzierten** Monde.
 *
 * Anders als bei den einzeln navigierbaren Koerpern gibt es hier nur zwei
 * Stufen: "instanced" (Oktaeder, 8 Dreiecke) als Dauerzustand und "low"
 * (Kugel, 12x8 Segmente) fuer den seltenen Fall, dass die Kamera sehr nah
 * an den Elternkoerper herankommt. "medium"/"high" wuerden bei bis zu 293
 * Instanzen je Gruppe mehr als eine Million Dreiecke kosten, ohne dass ein
 * Kind etwas sieht — die einzeln anklickbaren grossen Monde (Mond, Io,
 * Europa, Titan, Triton, Phobos, Deimos) haben eigene Meshes mit vollem
 * LOD bis `high`.
 */
export type InstancedLod = "instanced" | "low";

/** Ein Mond, der instanziert (in einem InstancedMesh) gerendert wird. */
interface InstancedMoon {
  /** Der Koerper aus `bodies.json`. */
  readonly body: SceneBody;
  /** Radius in Szeneneinheiten (Aequivalent zur Szenenskalierung). */
  readonly radius: number;
}

/** Wiederverwendete Matrix fuer die Instanz-Transformationen. */
const instanceMatrix = new THREE.Matrix4();

/** Wiederverwendeter Positions-Vektor (kein GC-Druck pro Bild). */
const instancePosition = new THREE.Vector3();

/**
 * Wiederverwendeter Weltpositions-Vektor fuer die LOD-Pruefung.
 *
 * `updateLod` laeuft pro Bild und pro Gruppe; ein `new Vector3()` pro
 * Aufruf wuerde bei 6 Gruppen und 60 Bildern pro Sekunde unnoetig Muell
 * erzeugen.
 */
const worldPositionScratch = new THREE.Vector3();

/**
 * Eine Gruppe instanzierter Monde an einem gemeinsamen Elternkoerper.
 *
 * Alle Monde dieser Gruppe teilen sich Geometrie und Material und werden mit
 * einem einzigen Draw-Call gezeichnet. Die Gruppe haengt als Kindobjekt am
 * Eltern-Mesh, damit sie beim Umlauf mitwandert (wie die Mondbahnlinien).
 */
class MoonInstanceGroup {
  /** Das `InstancedMesh` (1 Draw-Call fuer die ganze Gruppe). */
  readonly mesh: THREE.InstancedMesh;

  /** Die Monde dieser Gruppe in Instanz-Reihenfolge. */
  private readonly moons: readonly InstancedMoon[];

  /** Aktuell gesetzte Detailstufe der Geometrie. */
  private lod: InstancedLod = "instanced";

  /**
   * Geteilte Oktaeder-Geometrie (8 Dreiecke) fuer die Stufe "instanced".
   *
   * Wird einmal erzeugt und von allen Gruppen geteilt; bewusst **nicht** in
   * {@link disposeLodGeometries} — die Kugel-Geometrien sind die einzigen,
   * die zentral freigegeben werden, weil sie auch von BodyFactory stammen.
   */
  private static sharedGeo: THREE.OctahedronGeometry | null = null;

  /**
   * Liefert die geteilte Oktaeder-Geometrie der Stufe "instanced".
   *
   * @returns Die (immer gleiche) Geometrie mit Einheitsradius.
   */
  private static getInstancedGeometry(): THREE.OctahedronGeometry {
    if (MoonInstanceGroup.sharedGeo === null) {
      const geo = new THREE.OctahedronGeometry(1, 0);
      geo.name = "instanced-moon-octahedron";
      MoonInstanceGroup.sharedGeo = geo;
    }
    return MoonInstanceGroup.sharedGeo;
  }

  /** Radius des Elternkoerpers in Szeneneinheiten (fuer den LOD-Abstand). */
  private readonly parentRadius: number;

  /**
   * Erzeugt eine Gruppe instanzierter Monde.
   *
   * @param moons - Die Monde dieser Gruppe (darf leer sein).
   * @param parentRadius - Radius des Elternkoerpers in Szeneneinheiten.
   * @param scaleMode - Radius-Skalierungsmodus (bestimmt die Mondradien).
   * @throws {RangeError} Wenn `parentRadius` nicht positiv ist.
   */
  constructor(
    moons: readonly SceneBody[],
    parentRadius: number,
    scaleMode: ScaleMode,
  ) {
    if (!Number.isFinite(parentRadius) || parentRadius <= 0) {
      throw new RangeError(
        `parentRadius muss positiv sein, ist aber ${String(parentRadius)}.`,
      );
    }
    this.parentRadius = parentRadius;
    this.moons = moons.map((body) => ({
      body,
      radius: safeRenderRadius(body, scaleMode),
    }));

    const geometry = MoonInstanceGroup.getInstancedGeometry();
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.moons.length);
    this.mesh.name = `instanced-moons-${moons[0]?.parent ?? "unbekannt"}`;
    // Die Monde werden ueber die Matrizen bewegt, nicht ueber die Instanzfarben.
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = this.moons.length;
  }

  /**
   * Setzt die Weltpositionen aller Instanzen fuer einen Zeitpunkt.
   *
   * Die Positionen sind **lokal zum Elternkoerper** — die Gruppe haengt ja am
   * Eltern-Mesh und wandert dadurch von selbst mit.
   *
   * @param julianDate - Aktueller Zeitpunkt als Julian Date.
   * @param distanceMode - Distanz-Skalierungsmodus.
   * @returns {void}
   * @throws {RangeError} Wenn `julianDate` nicht endlich ist.
   */
  update(julianDate: number, distanceMode: DistanceMode): void {
    if (!Number.isFinite(julianDate)) {
      throw new RangeError(
        `julianDate muss eine endliche Zahl sein, ist aber ${String(julianDate)}.`,
      );
    }
    for (let i = 0; i < this.moons.length; i += 1) {
      const moon = this.moons[i]!;
      const state = orbitalPosition(moon.body, julianDate);
      const scaledAxis = scaleDistance(moon.body.semiMajorAxisKm, distanceMode);
      const factor = scaledAxis / moon.body.semiMajorAxisKm;
      instancePosition.set(
        state.position.x * factor,
        state.position.y * factor,
        state.position.z * factor,
      );
      instanceMatrix.makeScale(moon.radius, moon.radius, moon.radius);
      instanceMatrix.setPosition(instancePosition);
      this.mesh.setMatrixAt(i, instanceMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Wechselt die Detailstufe, wenn die Kamera sehr nah an den
   * Elternkoerper herankommt.
   *
   * Der Dauerzustand ist "instanced" (Oktaeder, 8 Dreiecke je Instanz — fuer
   * alle 449 kleinen Monde zusammen 3.592 Dreiecke). Erst wenn die Kamera
   * bis auf das 15-fache des Elternradius heran ist, wird auf die
   * `low`-Kugel (192 Dreiecke) umgeschaltet: dann sind die Monde gross genug
   * im Bild, dass ihre Rundung auffaellt. Eine Gruppe kann bis zu 293
   * Instanzen (Saturns kleine Monde) enthalten — `high` waeren dort
   * 900.000 Dreiecke fuer Koerper, die wenige Pixel gross sind. Die
   * einzeln navigierbaren grossen Monde (Mond, Io, Titan, ...) haben eigene
   * Meshes in {@link ../scene/BodyFactory} mit vollem LOD bis `high`.
   *
   * @param cameraPosition - Weltposition der Kamera.
   * @returns Die jetzt gesetzte Detailstufe.
   */
  updateLod(cameraPosition: THREE.Vector3): InstancedLod {
    const distance = cameraPosition.distanceTo(
      this.mesh.getWorldPosition(worldPositionScratch),
    );
    const next: InstancedLod =
      distance <= this.parentRadius * 15 ? "low" : "instanced";
    if (next !== this.lod) {
      this.lod = next;
      this.mesh.geometry =
        next === "instanced"
          ? MoonInstanceGroup.getInstancedGeometry()
          : getSphereGeometry("low");
    }
    return this.lod;
  }

  /** Anzahl der Instanzen in dieser Gruppe. */
  get count(): number {
    return this.moons.length;
  }

  /**
   * Loest Material und Geometrie (letztere ist geteilt) frei.
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
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * Verwaltet alle instanzierten Mond-Gruppen der Szene.
 *
 * Die Gruppen werden nach Elternkoerper sortiert, damit jede Gruppe genau
 * einen Draw-Call kostet und als Kindobjekt am Eltern-Mesh haengen kann.
 */
export class InstancedMoons {
  /** Gruppen nach ID des Elternkoerpers. */
  private readonly groups: Map<string, MoonInstanceGroup>;

  /** Koerper-ID -> zugehoerige Gruppe (fuer Statistik und LOD). */
  private readonly groupByBodyId: Map<string, MoonInstanceGroup>;

  /**
   * Erzeugt alle Gruppen aus der Koerperliste.
   *
   * @param bodies - Alle Koerper der Szene.
   * @param distances - Zuordnung Koerper-ID -> Radius in Szeneneinheiten.
   * @param scaleMode - Radius-Skalierungsmodus.
   */
  constructor(
    bodies: readonly SceneBody[],
    distances: ReadonlyMap<string, number>,
    scaleMode: ScaleMode,
  ) {
    this.groups = new Map();
    this.groupByBodyId = new Map();

    // Nach Eltern gruppieren; nur echte kleine Monde kommen hinein.
    const byParent = new Map<string, SceneBody[]>();
    for (const body of bodies) {
      if (body.type !== "moon" || isFeaturedMoon(body)) {
        continue;
      }
      const parent = body.parent ?? "";
      const list = byParent.get(parent);
      if (list === undefined) {
        byParent.set(parent, [body]);
      } else {
        list.push(body);
      }
    }

    for (const [parentId, moons] of byParent) {
      if (moons.length === 0) {
        continue;
      }
      const parentRadius = distances.get(parentId) ?? 1;
      const group = new MoonInstanceGroup(moons, parentRadius, scaleMode);
      this.groups.set(parentId, group);
      for (const moon of moons) {
        this.groupByBodyId.set(moon.id, group);
      }
    }
  }

  /**
   * Haengt jede Gruppe an ihr Eltern-Mesh.
   *
   * @param meshes - Koerper-ID -> Mesh des Elternkoerpers.
   * @returns {void}
   */
  attachTo(meshes: ReadonlyMap<string, THREE.Mesh>): void {
    for (const [parentId, group] of this.groups) {
      const parent = meshes.get(parentId);
      if (parent === undefined) {
        continue;
      }
      parent.add(group.mesh);
    }
  }

  /** Aktualisiert alle Instanzpositionen. */
  update(julianDate: number, distanceMode: DistanceMode): void {
    for (const group of this.groups.values()) {
      group.update(julianDate, distanceMode);
    }
  }

  /** Aktualisiert die Detailstufen aller Gruppen anhand der Kameraposition. */
  updateLod(cameraPosition: THREE.Vector3): void {
    for (const group of this.groups.values()) {
      group.updateLod(cameraPosition);
    }
  }

  /**
   * Blendet alle instanzierten Monde ein oder aus.
   *
   * Wird der Filter "Nur bekannte" aktiviert, sind die kleinen Monde ohne
   * Kindtext unsichtbar — sie bekommen dann keinen Zeichenaufruf mehr.
   *
   * @param visible - `true` = sichtbar, `false` = ausgeblendet.
   * @returns {void}
   */
  setVisible(visible: boolean): void {
    for (const group of this.groups.values()) {
      group.mesh.visible = visible;
    }
  }

  /**
   * Liefert alle Gruppen-Meshes (fuer Tests und Debug-Ausgaben).
   *
   * @returns Die `InstancedMesh`-Objekte aller Gruppen.
   */
  getObjectForTest(): THREE.InstancedMesh[] {
    return [...this.groups.values()].map((group) => group.mesh);
  }

  /** Gesamtanzahl der instanzierten Monde. */
  get count(): number {
    let total = 0;
    for (const group of this.groups.values()) {
      total += group.count;
    }
    return total;
  }

  /** Anzahl der Gruppen (und damit der Draw-Calls dieser Mondkategorie). */
  get groupCount(): number {
    return this.groups.size;
  }

  /**
   * Liefert den aktuellen Simulationszeitpunkt, mit dem die Gruppen gebaut
   * wurden. Nur fuer Debug-Ausgaben.
   *
   * @returns Aktueller Epoch-Bezug (J2000) als Julian Date.
   */
  static getEpochJulianDate(): number {
    return J2000_JULIAN_DATE;
  }

  /** Loest alle Gruppen frei. */
  dispose(): void {
    for (const group of this.groups.values()) {
      group.dispose();
    }
    this.groups.clear();
    this.groupByBodyId.clear();
  }
}
