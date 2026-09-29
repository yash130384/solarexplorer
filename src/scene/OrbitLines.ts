/**
 * Umlaufbahnlinien — pro Elternkoerper zu **einer** Linie zusammengefasst.
 *
 * Die Bahnen sind echte Kepler-Ellipsen: die Punkte werden mit
 * {@link orbitalPosition} ueber eine volle Umlaufperiode berechnet, nicht als
 * Kreis genaehert. Fuer Monde wird laut Spezifikation ein Kreis um den
 * Elternkoerper gezeichnet, der als Kindobjekt am Eltern-Mesh haengt.
 *
 * Draw-Call-Optimierung: bei 465 Koerpern waere ein `LineLoop` je Koerper
 * ~465 Zeichenschritte — bei einem Guertel-Kind mit 293 Monden allein 293
 * Draw-Calls, weil drei hundert Mal dasselbe Material und dieselbe
 * Geometrie-Art benutzt wird. Deshalb werden die Bahnen **pro
 * Elternkoerper zu einem einzigen `THREE.LineSegments` verschmolzen**: die
 * Punkte aller Bahnen liegen in einer Geometrie, ein Material, ein
 * Draw-Call. Bei 6 Planeten mit Monden sind das 6 statt 456 Aufrufe.
 *
 * Zusammengefasst wird ueber `LineSegments` (Paar-Punkte) statt `LineLoop`,
 * weil eine verschmolzene Geometrie sonst an den Enden der Einzelkreise
 * sichtbare Fehlstellen zeigte.
 *
 * @module scene/OrbitLines
 */

import * as THREE from "three";
import { AU_KM } from "../core/constants";
import {
  J2000_JULIAN_DATE,
  keplerOrbitalPeriodDays,
  orbitalPosition,
} from "../core/orbital";
import { scaleDistance } from "../core/scale";
import type { DistanceMode } from "../core/scale";
import type { SceneBody } from "./types";

/** Minimale Anzahl Segmente pro Planetenbahn, damit die Ellipse weich wirkt. */
const MIN_SEGMENTS = 180;

/**
 * Segmente pro **Mond**-Bahn.
 *
 * Monde sind winzig im Vergleich zu ihren Bahnen; 72 Stuetzpunkte reichen
 * fuer einen weichen Kreis und halbieren die Zahl der Linienpunkte
 * (wichtig: bei 456 Monden summiert sich das auf ~33.000 Vertices).
 */
const MOON_SEGMENTS = 72;

/** Opazitaet der Bahnlinien. */
const LINE_OPACITY = 0.45;

/** Farbe der Planetenbahnen. */
const PLANET_LINE_COLOR = "#5a7fb5";

/** Halbachse in AE, ab der eine Bahn als "fern" eingefaerbt wird. */
const FAR_AU = 3;

/** Farbe der Bahn des kleinsten Planeten (dunkler, fast unsichtbar). */
const FAR_LINE_COLOR = "#3d5a85";

/** Farbe der Mondbahnen. */
const MOON_LINE_COLOR = "#8fa3c0";

/**
 * Sammelt alle Umlaufbahnlinien einer Szene.
 *
 * Planetenbahnen liegen im Szenenursprung (die Sonne steht dort), Monde werden
 * als Kindobjekt des jeweiligen Eltern-Meshes positioniert. Deshalb liefert
 * die Klasse die Gruppen getrennt zurueck — der `SceneManager` haengt die
 * Monde in die Eltern-Meshes ein.
 */
export class OrbitLines {
  /** Verschmolzene Planetenbahnen (im Szenenursprung, 1 Draw-Call). */
  private readonly planetLine: THREE.LineSegments;

  /** Verschmolzene Mondbahnen, gruppiert nach der ID des Elternkoerpers. */
  private readonly moonLines: Map<string, THREE.LineSegments>;

  /** Koerper-IDs, die in {@link planetLine} gezeichnet werden. */
  private readonly planetBodyIds: readonly string[];

  /**
   * Erzeugt alle Umlaufbahnlinien.
   *
   * @param bodies - Alle Koerper der Szene.
   * @param sceneScale - Modus der Distanz-Skalierung; bestimmt, wie weit die
   *   Bahnen in Szeneneinheiten auseinander liegen.
   */
  constructor(bodies: readonly SceneBody[], sceneScale: DistanceMode) {
    this.planetLine = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        // Die Bahnen werden pro Koerper eingefaerbt (Nah=Farbe, Fern=dunkler).
        // Im verschmolzenen Mesh geht das nur ueber Vertexfarben.
        vertexColors: true,
        transparent: true,
        opacity: LINE_OPACITY,
      }),
    );
    this.planetLine.name = "orbit-planets";
    this.moonLines = new Map();
    this.planetBodyIds = [];

    /** Sammelpunkte je Eltern-ID (leeres Array = Sonne/Planeten). */
    const planetPoints: number[] = [];
    /** Vertexfarben (RGB) zu {@link planetPoints}, gleiche Laenge. */
    const planetColors: number[] = [];
    /** Koerper-IDs der Planeten, in Zeichenreihenfolge. */
    const planetIds: string[] = [];
    /** Sammelpunkte je Eltern-ID der Monde. */
    const moonPoints = new Map<string, number[]>();

    for (const body of bodies) {
      if (body.type === "star") {
        // Die Sonne steht im Ursprung und hat selbst keine Bahn.
        continue;
      }
      const isMoon = body.type === "moon" && body.parent !== null;
      if (isMoon) {
        const key = body.parent as string;
        const target = moonPoints.get(key) ?? [];
        moonPoints.set(key, target);
        OrbitLines.pushOrbit(body, sceneScale, target);
      } else {
        planetIds.push(body.id);
        const color = new THREE.Color(
          body.semiMajorAxisKm > FAR_AU * AU_KM ? FAR_LINE_COLOR : PLANET_LINE_COLOR,
        );
        OrbitLines.pushOrbit(body, sceneScale, planetPoints, color, planetColors);
      }
    }

    this.planetBodyIds = planetIds;
    OrbitLines.setPositions(this.planetLine, planetPoints);
    this.planetLine.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(planetColors, 3),
    );

    for (const [parentId, points] of moonPoints) {
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(MOON_LINE_COLOR),
          transparent: true,
          opacity: LINE_OPACITY,
        }),
      );
      line.name = `orbit-moons-${parentId}`;
      line.userData["parentId"] = parentId;
      OrbitLines.setPositions(line, points);
      this.moonLines.set(parentId, line);
    }
  }

  /**
   * Schreibt die Bahnpunkte eines Koerpers als Segmentpaare in `target`.
   *
   * Ein `LineSegments` zeichnet jeweils zwei aufeinanderfolgende Punkte als
   * eine Linie; fuer eine geschlossene Bahn wird deshalb jeder Punkt doppelt
   * eingetragen (Punkt *n* und Punkt *n+1*).
   *
   * @param body - Der Koerper.
   * @param sceneScale - Modus der Distanz-Skalierung.
   * @param target - Zielarray fuer die x/y/z-Werte.
   * @param color - Optionale Vertexfarbe; wenn gesetzt, wird sie je Punkt
   *   sechsmal (zwei Endpunkte mal RGB) in `colors` geschrieben.
   * @param colors - Zielarray fuer die RGB-Werte (nur mit `color` benutzt).
   * @returns {void}
   */
  private static pushOrbit(
    body: SceneBody,
    sceneScale: DistanceMode,
    target: number[],
    color?: THREE.Color,
    colors?: number[],
  ): void {
    const points = OrbitLines.sampleOrbit(body, sceneScale);
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      target.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (color !== undefined && colors !== undefined) {
        for (let vertex = 0; vertex < 2; vertex += 1) {
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }

  /**
   * Berechnet die Bahnpunkte eines Koerpers (geschlossener Polygonzug).
   *
   * Planeten: echte Ellipse, indem {@link orbitalPosition} ueber eine volle
   * Umlaufperiode ab J2000 durchlaufen wird. Da `scaleDistance` nicht linear
   * ist, wird die Km-Position mit dem konstanten Faktor
   * `scaledAxis / semiMajorAxisKm` in Szeneneinheiten umgerechnet — so bleibt
   * die Form der Ellipse erhalten.
   *
   * Monde: Kreis in der um die X-Achse gekippten Ebene, relativ zum
   * Elternkoerper.
   *
   * @param body - Der Koerper.
   * @param sceneScale - Modus der Distanz-Skalierung.
   * @returns Array von Szeneneinheiten-Punkten.
   */
  private static sampleOrbit(
    body: SceneBody,
    sceneScale: DistanceMode,
  ): THREE.Vector3[] {
    if (body.type === "moon") {
      return OrbitLines.sampleMoonCircle(body, sceneScale);
    }
    const periodDays = keplerOrbitalPeriodDays(body.semiMajorAxisKm, body.eccentricity);
    const segments = Math.max(MIN_SEGMENTS, Math.ceil(periodDays * 2));
    const scaledAxis = scaleDistance(body.semiMajorAxisKm, sceneScale);
    const factor = scaledAxis / body.semiMajorAxisKm;

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i += 1) {
      const daysSinceJ2000 = (periodDays * i) / segments;
      const jd = J2000_JULIAN_DATE + daysSinceJ2000;
      const state = orbitalPosition(body, jd);

      // `orbitalPosition` liefert die Szenenposition bereits fertig: die
      // Bahn liegt in der x/z-Ebene, `y` ist die Hoehe aus der Inklination
      // und der Knotenwinkel ist drin.
      //
      // Vorher wurde hier noch einmal von Hand nachgedreht — mit derselben
      // falschen Annahme wie in `core/orbital.ts` (Knoten aus der
      // Eigenrotation, Drehung in der x/y-Ebene). Das war nach der Korrektur
      // in `core/orbital.ts` doppelt falsch und stellte die Planetenbahnen
      // wieder senkrecht. Punkte werden deshalb unveraendert uebernommen und
      // nur mit `factor` von Kilometern auf Szeneneinheiten gebracht.
      points.push(
        new THREE.Vector3(
          state.position.x * factor,
          state.position.y * factor,
          state.position.z * factor,
        ),
      );
    }
    return points;
  }

  /**
   * Erzeugt die kreisfoermige Bahn eines Mondes.
   *
   * Der Kreis liegt in der Ebene, die um die X-Achse um die Inklination des
   * Mondes gekippt ist. Die Punkte sind relativ zum Elternkoerper — der
   * `SceneManager` haengt die Linie deshalb an das Eltern-Mesh.
   *
   * @param body - Der Mond.
   * @param sceneScale - Modus der Distanz-Skalierung.
   * @returns Die geschlossene Punktliste.
   */
  private static sampleMoonCircle(
    body: SceneBody,
    sceneScale: DistanceMode,
  ): THREE.Vector3[] {
    const scaledAxis = scaleDistance(body.semiMajorAxisKm, sceneScale);
    const inclination = THREE.MathUtils.degToRad(body.inclinationDeg);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < MOON_SEGMENTS; i += 1) {
      const angle = (i / MOON_SEGMENTS) * Math.PI * 2;
      // Die Kreise liegen in der x/z-Ebene — derselben Referenzebene wie
      // die Planetenbahnen. `y` ist die Hoehenachse und waechst nur mit der
      // Inklination.
      //
      // Vorher stand der Kreis in der x/y-Ebene (x = r*cos, y = r*sin). Damit
      // standen alle 456 Mondkreise senkrecht auf den Planetenbahnen und
      // ueberlagerten sich zu einem dichten Strahlenkreuz ueber dem ganzen
      // Bild, statt als flache Ringe um ihren Planeten zu erscheinen.
      const x = scaledAxis * Math.cos(angle);
      const z = scaledAxis * Math.sin(angle);
      const y = scaledAxis * Math.sin(angle) * Math.sin(inclination);
      points.push(new THREE.Vector3(x, y, z));
    }
    return points;
  }

  /**
   * Schreibt ein flaches Zahlenarray als Positionsattribut in die Geometrie.
   *
   * @param line - Die zu befuellende Linie.
   * @param values - x/y/z-Werte (Länge = Anzahl Punkte * 3).
   * @returns {void}
   */
  private static setPositions(line: THREE.LineSegments, values: number[]): void {
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry();
    line.geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(values, 3),
    );
  }

  /**
   * Liefert die verschmolzenen Planetenbahnen.
   *
   * @returns Die Linie (im Szenenursprung).
   */
  getObject(): THREE.LineSegments {
    return this.planetLine;
  }

  /**
   * Liefert die Mondbahnen, gruppiert nach Elternkoerper-ID.
   *
   * Der `SceneManager` haengt jede Linie als Kindobjekt an das Mesh des
   * jeweiligen Elternkoerpers, damit die Monde beim Umkreisen mitwandern.
   *
   * @returns Unveraenderliche Sicht der Map (Aendern erfordert Neuanlegen).
   */
  getMoonLines(): ReadonlyMap<string, THREE.LineSegments> {
    return this.moonLines;
  }

  /**
   * Liefert die IDs der Koerper, deren Bahn in {@link getObject} steckt.
   *
   * Nach dem Verschmelzen gibt es keine Linie mehr je Koerper; die IDs stehen
   * deshalb hier, damit Aufrufer (z. B. die Sichtbarkeitssteuerung) weiterhin
   * wissen, welche Bahn welche ist.
   *
   * @returns Koerper-IDs der Planetenbahnen in Zeichenreihenfolge.
   */
  getPlanetBodyIds(): readonly string[] {
    return this.planetBodyIds;
  }

  /**
   * Blendet Umlaufbahnen ein- oder aus.
   *
   * @param onlyPlanets - Wenn `true`, sind nur die Planetenbahnen sichtbar und
   *   die Monde fliegen ohne sichtbare Linie. Wenn `false`, sind alle da.
   * @returns {void}
   */
  setVisible(onlyPlanets: boolean): void {
    this.planetLine.visible = true;
    for (const line of this.moonLines.values()) {
      line.visible = !onlyPlanets;
    }
  }

  /**
   * Gibt alle Linien (Geometrie UND Material) frei.
   *
   * @returns {void}
   */
  dispose(): void {
    this.planetLine.geometry.dispose();
    const planetMaterial = this.planetLine.material;
    if (planetMaterial instanceof THREE.Material) {
      planetMaterial.dispose();
    }
    for (const line of this.moonLines.values()) {
      line.geometry.dispose();
      const material = line.material;
      if (material instanceof THREE.Material) {
        material.dispose();
      }
    }
    this.moonLines.clear();
    this.planetLine.removeFromParent();
  }
}
