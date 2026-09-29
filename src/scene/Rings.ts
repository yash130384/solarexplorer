/**
 * Ringsysteme der grossen Planeten.
 *
 * Saturn hat die beruehmten Ringe, Jupiter, Uranus und Neptun zartere. Die
 * Ringe werden als flache `THREE.RingGeometry` in der Ebene des
 * Aequators gezeichnet (tilted wie der Koerper selbst) und bekommen eine
 * **prozedural erzeugte** Alpha-Textur: eine Luecken-Struktur (Cassini-Luecke
 * bei Saturn, schmale Baender bei den anderen) als 1D-Gradient entlang des
 * Radius. Keine NASA-Bilder, keine Laufzeit-CDN.
 *
 * Incidence: aus der Ebene heraus gesehen (Kamera liegt in der Ringebene)
 * waeren die Ringe unendlich duenn und wuerden als Linie verschwinden. Deshalb
 * wird die Deckkraft an den Blickwinkel gekoppelt: je naeher der Blick von der
 * Ringebene entfernt ist, desto mehr bekommt man zu sehen — und die Ringe
 * werden gar nicht gezeichnet, wenn die Kamera innerhalb eines kleinen
 * Kegels um die Ringebene steht (`MIN_INCLINATION_DEG`).
 *
 * @module scene/Rings
 */

import * as THREE from "three";
import { scaleRadius } from "../core/scale";
import type { ScaleMode } from "../core/scale";
import type { SceneBody } from "./types";

/** Planeten, die ein Ringsystem besitzen. */
export const RING_PLANET_IDS: readonly string[] = ["jupiter", "saturn", "uranus", "neptun"];

/**
 * Innen- und Aussendurchmesser der Ringe als Vielfaches des Planetenradius.
 *
 * Saturn: B innen 1,11 / C 1,24-1,52 / B 1,52-1,95 / Cassini-Luecke / A 2,03-2,27.
 * Hier als eine Liste von Ringsegmenten (innen, aussen, Deckkraft).
 */
interface RingSpec {
  /** Innenradius als Vielfaches des Planetenradius. */
  readonly inner: number;
  /** Aussendurchmesser als Vielfaches des Planetenradius. */
  readonly outer: number;
  /** Grunddeckkraft des Rings. */
  readonly opacity: number;
  /** Farbe (Hex) des Rings. */
  readonly color: number;
  /** Relative Breite der Luecken (0..1, Anteil am Radiusintervall). */
  readonly gaps: readonly (readonly [number, number])[];
}

/** Definiert die Ringsysteme je Planet. */
const RING_SPECS: Readonly<Record<string, RingSpec>> = {
  jupiter: {
    inner: 1.4,
    outer: 1.81,
    opacity: 0.18,
    color: 0x9c8f7a,
    gaps: [
      [0.0, 0.3],
      [0.5, 0.62],
    ],
  },
  saturn: {
    inner: 1.11,
    outer: 2.32,
    opacity: 0.85,
    color: 0xd8c49a,
    gaps: [
      [0.11, 0.25], // C-Ring
      [0.39, 0.45], // B/C-Luecke
      [0.7, 0.78], // Cassini-Luecke
      [0.92, 0.96], // Encke-Luecke
    ],
  },
  uranus: {
    inner: 1.64,
    outer: 2.0,
    opacity: 0.12,
    color: 0x9fbfc4,
    gaps: [
      [0.45, 0.56],
    ],
  },
  neptun: {
    inner: 1.7,
    outer: 2.12,
    opacity: 0.14,
    color: 0x8aa3c8,
    gaps: [
      [0.4, 0.52],
    ],
  },
};

/**
 * Segmentzahl des Rings in radialer Richtung (Aufloesung der Textur).
 *
 * Der Ring ist eine flache Scheibe, deren Detail vollstaendig aus der
 * 1D-Alpha-Textur kommt — die Geometrie muss nur den Kreis annaehern.
 * 48 radiale Segmente reichen, weil zwischen den Stuetzpunkten interpoliert
 * wird. Frueher 96: das kostete 4 x 24.576 = 98.000 Dreiecke fuer vier
 * Ringe, ohne sichtbaren Unterschied.
 */
const RADIAL_SEGMENTS = 48;

/**
 * Winkelsegmente des Rings (Umfang).
 *
 * Hier ist die Aufloesung wichtiger als radial, weil der Umriss des Rings
 * die Form bestimmt; 96 ergibt ein sauberes, leicht polygonal wirkendes
 * Ellipsenoval, ohne sichtbare Kanten bei 144 (vorher).
 */
const THETA_SEGMENTS = 96;

/** Breite des weichen Uebergangs an den Lueckenraendern, in Pixeln. */
const EDGE_SOFTNESS_PX = 2;

/**
 * Kleinster Einfallwinkel (Grad) zwischen Blickrichtung und Ringebene, ab dem
 * die Ringe sichtbar sind. Darunter (Kamera in der Ebene) waeren sie eine
 * unendlich duenne Linie — sie werden dann ausgeblendet.
 */
const MIN_INCLINATION_DEG = 6;

/**
 * Erzeugt eine prozedurale Ring-Textur: ein radialer Alpha-Verlauf mit
 * Luecken und leichter Farbstreuung, damit es nicht wie eine eingefaerbte
 * Scheibe aussieht.
 *
 * Erzeugt als `THREE.DataTexture` (RGBA, 1 x N) — kein Bild, keine Datei.
 *
 * @param spec - Definition des Rings.
 * @param width - Breite der Textur in Pixeln (>= 2).
 * @returns Die fertige Textur mit Alpha-Verlauf.
 * @throws {RangeError} Wenn `width < 2` oder `spec` ungueltig ist.
 */
export function createRingTexture(spec: RingSpec, width: number): THREE.DataTexture {
  if (!Number.isInteger(width) || width < 2) {
    throw new RangeError(`Ringtextur braucht eine Breite >= 2, ist aber ${String(width)}.`);
  }
  if (!Number.isFinite(spec.inner) || spec.inner <= 0 || spec.outer <= spec.inner) {
    throw new RangeError("Ring-Spezifikation hat keinen gueltigen Radiusbereich.");
  }
  const data = new Uint8Array(width * 4);
  const base = new THREE.Color(spec.color);
  for (let x = 0; x < width; x += 1) {
    // t = 0 innen .. 1 aussen
    const t = x / (width - 1);
    // Innerhalb einer Luecke: alpha 0. Direkt an den Lueckenraendern wird
    // ueber `soft` weich ausgeblendet, damit die Ringe nicht "flattern".
    let inGap = false;
    let soft = 1;
    for (const [from, to] of spec.gaps) {
      if (t >= from && t <= to) {
        inGap = true;
        soft = 0;
        break;
      }
      // Abstand zur naechsten Luecke in Pixeln (0 = direkt davor).
      const toStart = Math.abs(t - from) * (width - 1);
      const toEnd = Math.abs(t - to) * (width - 1);
      const edge = Math.min(toStart, toEnd);
      if (edge < EDGE_SOFTNESS_PX) {
        soft = Math.min(soft, edge / EDGE_SOFTNESS_PX);
      }
    }
    // Grundverlauf: aussen heller als innen.
    const radial = 0.7 + 0.3 * t;
    const alpha = inGap ? 0 : Math.round(255 * spec.opacity * radial * soft);
    // Leichte Farbstreuung (helle Streifen = Eis, dunkle = Gestein).
    const streak = 0.85 + 0.15 * Math.sin(t * 47.0);
    data[x * 4 + 0] = Math.round(base.r * 255 * streak);
    data[x * 4 + 1] = Math.round(base.g * 255 * streak);
    data[x * 4 + 2] = Math.round(base.b * 255 * streak);
    data[x * 4 + 3] = alpha;
  }
  const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  texture.name = "ring-texture";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Das Ringsystem eines Planeten (Mesh + zugehoerige Textur).
 */
export interface RingSystem {
  /** Der Planetenkoerper, zu dem das Ringobjekt gehoert. */
  readonly body: SceneBody;
  /** Das Ring-Mesh (Kindobjekt am Planeten-Mesh). */
  readonly mesh: THREE.Mesh;
  /** Aequatordrehung des Planeten in Grad — haengt an der Ringneigung. */
  readonly axialTiltDeg: number;
  /** Loest Mesh, Material und Textur frei. */
  dispose(): void;
}

/**
 * Erzeugt das Ringsystem eines Planeten.
 *
 * @param body - Der Planet aus `bodies.json`.
 * @param scaleMode - Radius-Skalierungsmodus.
 * @returns Das Ringsystem oder `null`, wenn der Planet keine Ringe hat.
 */
export function createRingSystem(
  body: SceneBody,
  scaleMode: ScaleMode,
): RingSystem | null {
  if (body.type !== "planet") {
    return null;
  }
  const spec = RING_SPECS[body.id];
  if (spec === undefined) {
    return null;
  }

  const planetRadius = scaleRadius(body.radiusKm, scaleMode);
  const geometry = new THREE.RingGeometry(
    planetRadius * spec.inner,
    planetRadius * spec.outer,
    THETA_SEGMENTS,
    RADIAL_SEGMENTS,
  );
  // Die RingGeometry-UV laeuft radial von 0 (innen) nach 1 (aussen) — genau
  // so, wie die 1D-Textur aufgebaut ist.
  const texture = createRingTexture(spec, 256);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    alphaMap: texture,
    transparent: true,
    opacity: spec.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${body.id}-ring`;
  // `RingGeometry` liegt in der XY-Ebene, seine Normale ist also die lokale
  // Z-Achse. Durch die Drehung um -90 Grad um X wandert sie auf die lokale
  // Y-Achse: der Ring liegt damit in der XZ-Ebene, also waagerecht zur
  // Aequatorebene des Planeten. Die Achsenneigung des Planeten kommt
  // automatisch ueber das Eltern-Mesh dazu.
  mesh.rotation.x = -Math.PI / 2;

  return {
    body,
    mesh,
    axialTiltDeg: body.axialTiltDeg,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      mesh.removeFromParent();
    },
  };
}

/**
 * Wiederverwendete Zwischenwerte fuer {@link updateRingVisibility}.
 *
 * Die Funktion laeuft pro Bild fuer jeden der vier Ringe. Ohne Scratch-
 * Objekte waeren das 4 Ringe x 60 Bilder = 240 `Vector3`/`Quaternion`
 * pro Sekunde — genau der Muell, den die Instancing-Optimierung
 * vermeiden soll.
 */
const ringCenter = new THREE.Vector3();
const ringView = new THREE.Vector3();
const ringNormal = new THREE.Vector3();
const ringQuaternion = new THREE.Quaternion();

/**
 * Blendet die Ringe ab, wenn die Kamera in der Ringebene steht (Incidence).
 *
 * Der Aufruf geschieht pro Bild aus dem `SceneManager`. Der Winkel zwischen der
 * Blickrichtung (Kamera -> Ringmitte) und der Ringebene bestimmt, ob die Ringe
 * ueberhaupt etwas zeigen: unterhalb {@link MIN_INCLINATION_DEG} werden sie
 * unsichtbar geschaltet, danach blendet die Deckkraft weich ein.
 *
 * @param ring - Das Ringsystem, dessen Deckkraft angepasst wird.
 * @param cameraPosition - Weltposition der Kamera.
 * @param opacity - Grunddeckkraft des Rings (aus `spec`).
 * @returns Die jetzt gesetzte Deckkraft (0 = unsichtbar).
 * @throws {RangeError} Wenn `opacity` ausserhalb 0..1 liegt.
 */
export function updateRingVisibility(
  ring: RingSystem,
  cameraPosition: THREE.Vector3,
  opacity: number,
): number {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(`opacity muss zwischen 0 und 1 liegen, ist aber ${String(opacity)}.`);
  }
  // Weltposition des Ring-Mittelpunkts (der Planet).
  ring.mesh.getWorldPosition(ringCenter);
  // Blickrichtung von der Kamera zum Ring.
  ringView.copy(ringCenter).sub(cameraPosition).normalize();
  // Ringnormale: `RingGeometry` liegt in der lokalen XY-Ebene, seine
  // Normale ist die lokale Z-Achse. Nach der Drehung des Meshes um -90 Grad
  // um X zeigt sie in die Welt — deshalb wird die lokale Z-Achse und nicht
  // die Y-Achse transformiert.
  ring.mesh.getWorldQuaternion(ringQuaternion);
  ringNormal.set(0, 0, 1).applyQuaternion(ringQuaternion).normalize();
  // Winkel zwischen Blickrichtung und Ringnormalen: 0 Grad heisst "senkrecht
  // von oben auf den Ring" (rings gut sichtbar), 90 Grad heisst "Kamera in der
  // Ringebene" (Ringe sind eine unendlich duenne Linie, also unsichtbar).
  const cosAngle = Math.abs(ringView.dot(ringNormal));
  const angleDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosAngle, 0, 1)));
  // Der Winkel zur *Ebene* ist 90 - angleDeg. Wir wollen die Ringe ab
  // `MIN_INCLINATION_DEG` zur Ebene sichtbar machen.
  const toPlane = 90 - angleDeg;
  if (toPlane < MIN_INCLINATION_DEG) {
    ring.mesh.visible = false;
    return 0;
  }
  ring.mesh.visible = true;
  // Weicher Verlauf ueber ~20 Grad, danach volle Deckkraft.
  const fade = THREE.MathUtils.clamp(
    (toPlane - MIN_INCLINATION_DEG) / 20,
    0,
    1,
  );
  const material = ring.mesh.material as THREE.MeshBasicMaterial;
  material.opacity = opacity * fade;
  return material.opacity;
}

/**
 * Verwaltet die Ringsysteme aller vier Planeten.
 */
export class Rings {
  /** Alle Ringsysteme der Szene, nach Planeten-ID. */
  private readonly systems: Map<string, RingSystem>;

  /** Grunddeckkraft je Planeten-ID (fuer {@link Rings.update}). */
  private readonly opacities: Map<string, number>;

  /**
   * Erzeugt alle Ringsysteme fuer die uebergebenen Planeten.
   *
   * @param bodies - Die Planeten aus `bodies.json` (4 mit Ringen erwartet).
   * @param scaleMode - Radius-Skalierungsmodus.
   */
  constructor(bodies: readonly SceneBody[], scaleMode: ScaleMode) {
    this.systems = new Map();
    this.opacities = new Map();
    for (const body of bodies) {
      if (body.type !== "planet") {
        continue;
      }
      const spec = RING_SPECS[body.id];
      if (spec === undefined) {
        continue;
      }
      const ring = createRingSystem(body, scaleMode);
      if (ring === null) {
        continue;
      }
      this.systems.set(body.id, ring);
      this.opacities.set(body.id, spec.opacity);
    }
  }

  /**
   * Haengt die Ring-Meshes an die zugehoerigen Planeten-Meshes.
   *
   * @param meshes - Koerper-ID -> Planeten-Mesh.
   * @returns {void}
   */
  attachTo(meshes: ReadonlyMap<string, THREE.Mesh>): void {
    for (const [bodyId, ring] of this.systems) {
      const parent = meshes.get(bodyId);
      if (parent === undefined) {
        continue;
      }
      parent.add(ring.mesh);
    }
  }

  /**
   * Aktualisiert die Sichtbarkeit aller Ringe anhand der Kameraposition.
   *
   * @param cameraPosition - Weltposition der Kamera.
   * @returns {void}
   */
  update(cameraPosition: THREE.Vector3): void {
    for (const [bodyId, ring] of this.systems) {
      const opacity = this.opacities.get(bodyId) ?? 1;
      updateRingVisibility(ring, cameraPosition, opacity);
    }
  }

  /** Anzahl der Ringsysteme in der Szene (sollte 4 sein). */
  get count(): number {
    return this.systems.size;
  }

  /**
   * Loest alle Ringsysteme frei.
   *
   * @returns {void}
   */
  dispose(): void {
    for (const ring of this.systems.values()) {
      ring.dispose();
    }
    this.systems.clear();
    this.opacities.clear();
  }
}
