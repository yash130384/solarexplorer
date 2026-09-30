/**
 * Erzeugung der Koerper-Meshes (Sonne, Planeten, Monde).
 *
 * Die Fabrik ist bewusst zustandslos und statisch: sie uebersetzt ein
 * {@link SceneBody} plus die aktiven Skalierungsmodi in ein fertiges
 * `THREE.Mesh`. Die Oberflaechen-Textur kommt aus {@link getTexture}, also
 * synchron aus dem Cache von `scene/textures` — geladen wird sie dort
 * einmalig vor dem Szenenaufbau (`SceneManager.loadTextures`).
 *
 * @module scene/BodyFactory
 */

import * as THREE from "three";
import type { DistanceMode, ScaleMode } from "../core/scale";
import { applyLodToMesh, SHARED_GEOMETRY_PREFIX } from "./LodCache";
import type { LodLevel } from "./LodCache";
import { boostSunSurface } from "./SunGlow";
import { getTexture, getRoughnessTexture, getNormalTexture } from "./textures";
import { safeRenderRadius } from "./types";
import type { SceneBody } from "./types";

/**
 * Start-Detailstufe fuer die Sonne: sie ist gross und immer im Bild.
 */
const STAR_LOD: LodLevel = "high";

/** Start-Detailstufe fuer Planeten, die nah an der Sonne liegen. */
const NEAR_LOD: LodLevel = "high";

/** Start-Detailstufe fuer entfernte Planeten und Monde. */
const FAR_LOD: LodLevel = "low";

/** Ab dieser Distanz (in AE) gilt ein Koerper als "fern". */
const NEAR_AU_LIMIT = 2.0;

/** Farbe des Sonnenkorpus. */
const SUN_COLOR = 0xffb000;

/** Farbe der additiven Gluehhaelle. */
const GLOW_COLOR = 0xff8a1a;

/** Anteil des Gluehradials relativ zum Sonnenradius. */
const GLOW_SCALE = 1.45;

/** Opazitaet der Gluehhaelle. */
const GLOW_OPACITY = 0.28;

/** Name des Nutzdaten-Keys, unter dem die Koerper-ID am Mesh haengt. */
const BODY_ID_KEY = "bodyId";

/**
 * Bestimmt die Start-Detailstufe einer Kugel (LOD).
 *
 * Die Geometrien selbst sind geteilt (siehe `scene/LodCache`); hier wird nur
 * entschieden, mit welcher der drei Stufen ein Koerper startet. Der
 * `SceneManager` schaltet danach anhand der Kameradistanz um.
 *
 * @param body - Der Koerper, dessen Detailstufe bestimmt wird.
 * @returns `high` fuer Sonne und nahe Planeten, sonst `low`.
 */
function lodFor(body: SceneBody): LodLevel {
  if (body.type === "star") {
    return STAR_LOD;
  }
  // Monde sind immer klein und weit weg — geringeres Detail genuegt.
  if (body.type === "moon") {
    return FAR_LOD;
  }
  return body.semiMajorAxisKm <= NEAR_AU_LIMIT * 149_597_870.7 ? NEAR_LOD : FAR_LOD;
}

/**
 * Fabrik fuer alle Koerper-Meshes der Szene.
 *
 * Alle Methoden sind statisch: die Klasse besitzt keinen Zustand und ist
 * damit von der Szene unabhaengig testbar.
 */
export class BodyFactory {
  /**
   * Erzeugt das Material eines Koerpers.
  *
  * Bewusst getrennt von {@link BodyFactory.create}, damit hier (ohne die
  * Geometrie-Logik zu beruehren) die Textur gesetzt wird.
  *
  * Die Textur ist eine Equirectangular-Karte (2:1) und wird ueber
  * `map`, `roughnessMap` und `normalMap` gesetzt:
  *
  * - Die LOD-Kugeln aus `scene/LodCache` sind `THREE.SphereGeometry` und
  *   bringen ihre Standard-UV-Koordinaten mit: `u` = Laengengrad,
  *   `v` = Breitengrad, nahtlos bei `u` = 0/1. Ein eigenes UV-Mapping ist
  *   deshalb weder noetig noch moeglich — die Geometrie liegt im Cache und
  *   wird von mehreren Koerpern geteilt.
  * - `textures.ts` setzt `wrapS = RepeatWrapping`, damit die Naht bei
  *   0°/360° verschwindet, und `SRGBColorSpace` fuer die Farbtextur
  *   (sowie `NoColorSpace` fuer Rauheits-/Normalmaps).
  * - `normalMap`/`roughnessMap` werden aus den prozedural erzeugten
  *   `<bodyId>_normal.png` / `<bodyId>_roughness.png` geladen. Fehlt eine
  *   Datei, bleibt der Kanal `null` und Three.js verwendet die
  *   Material-Standardwerte (`roughness: 0.9`, keine Normalabweichung).
  * - Fehlt die Farbtextur, bleibt die Farbe aus `bodies.json` als
  *   Multiplikator stehen — der Koerper faellt auf einfarbig zurueck.
  * - Die Sonne bleibt bewusst einfarbig (MeshBasicMaterial mit HDR-Gain),
  *   da eine Textur dort den Bloom-Effekt stoeren wuerde.
  *
  * @param body - Koerper, fuer den das Material erzeugt wird.
  * @param textures - `false` laesst den Koerper einfarbig. Nur als
  *   Messschalter gedacht (siehe `SceneOptions.textures`); im Normalbetrieb
  *   bleibt der Wert `true`.
  * @returns Material-Instanz: `MeshBasicMaterial` (HDR) fuer die Sonne,
  *   sonst `MeshStandardMaterial` in der Farbe aus `bodies.json` mit Textur.
  */
  static createMaterial(
    body: SceneBody,
    textures: boolean = true,
  ): THREE.Material {
    if (body.type === "star") {
      // Die Sonne leuchtet selbst — sie reagiert nicht auf Licht.
      return new THREE.MeshBasicMaterial({ color: SUN_COLOR });
    }
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(body.color),
      roughness: 0.9,
      metalness: 0.0,
      flatShading: false,
      map: textures ? getTexture(body.id) : null,
      roughnessMap: textures ? getRoughnessTexture(body.id) : null,
      normalMap: textures ? getNormalTexture(body.id) : null,
    });
  }

  /**
   * Erzeugt ein vollstaendiges Mesh fuer einen Koerper.
   *
   * Die Sonne bekommt zusaetzlich eine additive Gluehhaelle als Kindobjekt,
   * damit sie ohne Textur wie eine Lichtquelle wirkt.
   *
   * @param body - Koerper aus `bodies.json`.
   * @param scaleMode - Modus der Radius-Skalierung.
   * @param distanceMode - Modus der Distanz-Skalierung (fuer die LOD-Stufe).
   * @returns Das fertige Mesh; seine Position wird vom `SceneManager` gesetzt.
   * @throws {RangeError} Wenn der Radius nicht skalierbar ist.
   */
  static create(
    body: SceneBody,
    scaleMode: ScaleMode,
    distanceMode: DistanceMode,
    textures: boolean = true,
  ): THREE.Mesh {
    // Der Radius haengt nur vom Radius-Modus ab. `distanceMode` wird fuer die
    // Detailstufe weiter unten ausgewertet (ueber `segmentsFor`), damit die
    // Parameterliste der Spezifikation erhalten bleibt.
    void distanceMode;

    const radius = safeRenderRadius(body, scaleMode);
    const level = lodFor(body);

    const material = BodyFactory.createMaterial(body, textures);

    const mesh = new THREE.Mesh();
    // Die Kugelgeometrie ist geteilt (eine pro Detailstufe, siehe LodCache);
    // der Radius sitzt deshalb in `mesh.scale`, nicht in der Geometrie.
    applyLodToMesh(mesh, level, radius);
    mesh.material = material;
    mesh.name = body.id;
    mesh.userData[BODY_ID_KEY] = body.id;

    // Achsneigung: die Kugel wird um ihre eigene Achse gekippt. Bei
    // retrograder Rotation (z. B. Venus) ist der Neigungswert > 90 Grad, was
    // genau das gewuenschte Ueberkippen ergibt.
    mesh.rotation.order = "ZXY";
    mesh.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDeg);

    if (body.type === "star") {
      // Die Farbe des Korpus wird ueber die Schwelle des Bloom-Passes gehoben
      // (L 0.523 -> 1.308), damit die Sonne als einziger Koerper bluetet.
      boostSunSurface(mesh);

      // Die Gluehhaelle ist die einzige Geometrie, die pro Koerper eigens
      // erzeugt wird: sie ist zweiteilig (BackSide) und gibt es nur einmal.
      // Sie bleibt unter der Bloom-Schwelle (L ~ 0.2) und wirkt deshalb auch
      // dann, wenn kein Postprocessing laeuft (Qualitaetsstufe `low`).
      const glowGeometry = new THREE.SphereGeometry(
        radius * GLOW_SCALE,
        64,
        32,
      );
      const glow = new THREE.Mesh(
        glowGeometry,
        new THREE.MeshBasicMaterial({
          color: GLOW_COLOR,
          transparent: true,
          opacity: GLOW_OPACITY,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );
      glow.name = `${body.id}-glow`;
      mesh.add(glow);
    }

    return mesh;
  }

  /**
   * Gibt ein Mesh samt Kindobjekten (Gluehhaelle) vollstaendig frei.
   *
   * Die geteilten LOD-Geometrien werden dabei **nicht** freigegeben — sie
   * gehoeren `scene/LodCache` und werden erst dort (beim Abbau der gesamten
   * Szene ueber {@link disposeLodGeometries}) geloescht. Erkennbar sind sie an
   * ihrem Namen (`lod-sphere-*`).
   *
   * @param mesh - Das Mesh, das freigegeben werden soll.
   * @returns {void}
   */
  static dispose(mesh: THREE.Mesh): void {
    mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      if (!child.geometry.name.startsWith(SHARED_GEOMETRY_PREFIX)) {
        child.geometry.dispose();
      }
      const material = child.material;
      if (Array.isArray(material)) {
        for (const entry of material) {
          entry.dispose();
        }
      } else {
        material.dispose();
      }
    });
    mesh.removeFromParent();
  }
}
