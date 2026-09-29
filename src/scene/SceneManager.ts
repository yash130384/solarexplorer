/**
 * Zentrale Verwaltung der Three.js-Szene.
 *
 * `SceneManager` besitzt Renderer, Kamera, Licht, Koerper, Umlaufbahnen und
 * Sternenhimmel und ist die einzige Anlaufstelle fuer die App (siehe
 * `src/main.ts`). Alle Geometrien und Materialien werden ueber
 * {@link SceneManager.dispose} wieder freigegeben, damit beim Wechsel zwischen
 * Seitenaufrufen kein WebGL-Speicher undokumentiert belegt bleibt.
 *
 * @module scene/SceneManager
 */

import * as THREE from "three";
import {
  DISTANCE_FAR,
  DISTANCE_NEAR,
  J2000_UNIX,
} from "../core/constants";
import { J2000_JULIAN_DATE, orbitalPosition } from "../core/orbital";
import { scaleDistance, scaleRadius } from "../core/scale";
import type { DistanceMode, ScaleMode } from "../core/scale";
import { BodyFactory } from "./BodyFactory";
import { Belt } from "./Belt";
import { InstancedMoons, isFeaturedMoon } from "./InstancedMoons";
import { applyLodByDistance, disposeLodGeometries } from "./LodCache";
import { OrbitLines } from "./OrbitLines";
import { Rings } from "./Rings";
import { DEFAULT_STARFIELD_RADIUS, Starfield } from "./Starfield";
import { detectQualityLevel, detectRendererName, getQualityProfile } from "./quality";
import type { QualityLevel } from "./quality";
import { loadSceneBodies, safeRenderRadius } from "./types";
import type { SceneBody, SceneOptions, SceneStats } from "./types";

/** Oeffnungswinkel der Perspektivkamera in Grad. */
const CAMERA_FOV = 50;

/**
 * Startposition der Kamera: schaut von schraeg oben auf das Sonnensystem.
 *
 * Muss zur Groessenordnung der Umlaufbahnen passen. In der Distanzskalierung
 * "visual" liegt Neptun bei ~434 Szeneneinheiten, Uranus bei ~390.
 *
 * Die Werte sind nicht geschaetzt, sondern gerechnet: bei 50 Grad
 * Oeffnungswinkel und 1280x720 Bildformat ergibt der Kamerastand
 * (0, 150, 850) — rund 864 Einheiten von der Sonne entfernt — einen
 * worst-case NDC-Wert von 0,71 ueber den gesamten Neptun-Bahnkreis. Damit
 * liegen alle acht Bahnen sicher im Bild (|ndc| <= 1), mit Reserve fuer die
 * Bahnkurve selbst. Aus (0, 110, 560) fielen Uranus und Neptun heraus
 * (ndc 1,06 und 1,38).
 */
const INITIAL_CAMERA_POSITION: readonly [number, number, number] = [0, 150, 850];

/** Standarddistanz der Kamera, multipliziert mit dem Radius des Koerpers. */
const DEFAULT_FOCUS_FACTOR = 6;

/** Interne Zielposition der Kamera, je Achse interpoliert. */
interface CameraTarget {
  /** Zielkoordinate auf der X-Achse (Position der Kamera). */
  x: number;
  /** Zielkoordinate auf der Y-Achse (Position der Kamera). */
  y: number;
  /** Zielkoordinate auf der Z-Achse (Position der Kamera). */
  z: number;
}

/**
 * Verwaltet die komplette 3D-Szene des SolarExplorers.
 */
export class SceneManager {
  /** Das Canvas, in das gerendert wird. */
  private readonly canvas: HTMLCanvasElement;

  /** Die Three.js-Szene. */
  private scene: THREE.Scene;

  /** Die Perspektivkamera. */
  private camera: THREE.PerspectiveCamera;

  /** Der WebGL-Renderer. */
  private renderer: THREE.WebGLRenderer | null = null;

  /** Aktive Optionen (Skalierungsmodi). */
  private options: SceneOptions;

  /** Alle Koerper der Szene, wie aus `bodies.json` geladen. */
  private bodies: SceneBody[];

  /** Netz aus den Koerper-Meshes, zentriert im Szenenursprung. */
  private readonly bodyGroup: THREE.Group;

  /** Koerper-ID -> Mesh. */
  private readonly meshes: Map<string, THREE.Mesh>;

  /** Umlaufbahnlinien (Planeten + Monde). */
  private orbitLines: OrbitLines | null = null;

  /** Ringsysteme der vier Planeten mit Ringen. */
  private rings: Rings | null = null;

  /** Asteroidenguertel (ein InstancedMesh) + Kometen. */
  private belt: Belt | null = null;

  /** Instanzierte kleine Monde (ein Draw-Call je Elternkoerper). */
  private instancedMoons: InstancedMoons | null = null;

  /** Aktiver Detailfilter: alle Koerper oder nur die mit Kindtext. */
  private knownOnly = false;

  /**
   * Erkannte Qualitaetsstufe (siehe `scene/quality`).
   *
   * Wird einmal beim Erzeugen bestimmt und steuert Kantenglaettung,
   * Pixel-Ratio und Sternenzahl. Ohne GPU ist `low` die einzige Stufe, die
   * die Bildrate eines Kindersystems ueber 30 FPS hebt.
   */
  private readonly quality: QualityLevel = detectQualityLevel();

  /** Name des erkannten Grafiktreibers (nur fuer Diagnose/Tests). */
  private rendererName = "unbekannt";

  /** Sternenhimmel. */
  private starfield: Starfield | null = null;

  /** Aktueller Simulationszeitpunkt als Julian Date. */
  private julianDate: number = J2000_JULIAN_DATE;

  /** Ziel, auf das die Kamera weich (per Lerp) zusteuert. */
  private cameraTarget: CameraTarget;

  /**
   * Punkt, den die Kamera ansieht — **nicht** ihre eigene Position.
   *
   * Das muss getrennt von {@link SceneManager.cameraTarget} sein: die Kamera
   * faehrt auf einen Punkt *vor* dem Koerper, schaut aber *auf* den Koerper.
   */
  private lookTarget: CameraTarget;

  /** Handler fuer das `resize`-Event, wird in `dispose` wieder entfernt. */
  private readonly onResize: () => void;

  /** Merkt sich, ob `dispose` bereits aufgerufen wurde. */
  private disposed = false;

  /**
   * Erzeugt einen `SceneManager` und legt Szene, Kamera und Body-Gruppe an.
   *
   * Der WebGL-Renderer wird erst in {@link SceneManager.init} erzeugt, damit
   * die Konstruktion auch in Umgebungen ohne WebGL funktioniert (z. B. Tests).
   *
   * @param canvas - Das Ziel-Canvas.
   * @param options - Anfangs-Skalierungsmodi.
   * @throws {TypeError} Wenn `canvas` kein HTMLCanvasElement ist.
   */
  constructor(canvas: HTMLCanvasElement, options: SceneOptions) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("SceneManager braucht ein HTMLCanvasElement.");
    }
    this.canvas = canvas;
    this.options = options;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.name = "SolarExplorer";

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      1,
      DISTANCE_NEAR,
      DISTANCE_FAR,
    );
    this.camera.position.set(...INITIAL_CAMERA_POSITION);
    this.camera.lookAt(0, 0, 0);
    this.camera.name = "MainCamera";

    this.bodies = loadSceneBodies();
    this.meshes = new Map();
    this.bodyGroup = new THREE.Group();
    this.bodyGroup.name = "Bodies";
    this.scene.add(this.bodyGroup);

    this.cameraTarget = {
      x: INITIAL_CAMERA_POSITION[0],
      y: INITIAL_CAMERA_POSITION[1],
      z: INITIAL_CAMERA_POSITION[2],
    };
    this.lookTarget = { x: 0, y: 0, z: 0 };

    this.onResize = (): void => {
      this.resize();
    };
  }

  /**
   * Baut Renderer, Licht, Koerper, Bahnen und Sterne auf.
   *
   * Mehrfaches Aufrufen ist unschaedlich: ein bereits initialisierter Manager
   * wird ignoriert.
   *
   * @returns {void}
   */
  init(): void {
    if (this.renderer !== null) {
      return;
    }

    // Qualitaetsstufe einmalig aus der Hardware ableiten (siehe scene/quality).
    // Ohne GPU — headless-Chromium, VM, Software-Rasterisierung — kostet
    // Kantenglaettung ein Vielfaches der Bildrate, ohne sichtbaren Gewinn.
    const profile = getQualityProfile(this.quality);
    this.rendererName = detectRendererName();

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: profile.antialias,
      powerPreference: "high-performance",
    });
    // Hohe DPI-Geraete sollen nicht unnoetig Rechenleistung verbrennen.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, profile.maxPixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;

    this.addLights();
    this.addStarfield();
    this.addBodies();
    this.addOrbitLines();
    this.addBelt();

    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  /**
   * Fuegt Hemisphaeren- und Umgebungslicht hinzu.
   *
   * Das Hemisphaerenlicht steht oben (Sonnenseite) und laesst die Nachtseite
   * dunkel, das schwache Umgebungslicht verhindert komplett schwarze Schatten.
   *
   * @returns {void}
   */
  private addLights(): void {
    const sunLight = new THREE.HemisphereLight(0xfff4e0, 0x101828, 1.6);
    sunLight.name = "SunLight";
    sunLight.position.set(0, 1, 0);
    this.scene.add(sunLight);

    const ambient = new THREE.AmbientLight(0x404a60, 0.35);
    ambient.name = "AmbientLight";
    this.scene.add(ambient);
  }

  /**
   * Erzeugt und fuegt den Sternenhimmel ein.
   *
   * @returns {void}
   */
  private addStarfield(): void {
    // Die Sternenzahl haengt an der Qualitaetsstufe: auf Systemen ohne GPU
    // ist jeder weitere Stern ein Fuellraten-Kostenpunkt ohne sichtbaren
    // Gewinn (Sterne sind 1 Pixel gross).
    const stars = getQualityProfile(this.quality).starCount;
    this.starfield = new Starfield(stars, DEFAULT_STARFIELD_RADIUS);
    this.scene.add(this.starfield.getObject());
  }

  /**
   * Liefert die erkannte Qualitaetsstufe und den Grafiktreiber.
   *
   * Wird im E2E-Test mitprotokolliert, damit die gemessene Bildrate
   * einordbar ist: 30 FPS auf einer echten GPU sind etwas voellig anderes
   * als 30 FPS auf einem Software-Rasterisierer.
   *
   * @returns Qualitaetsstufe, Treibername und das aktive Profil.
   */
  getQuality(): { level: QualityLevel; renderer: string; antialias: boolean; maxPixelRatio: number } {
    const profile = getQualityProfile(this.quality);
    return {
      level: this.quality,
      renderer: this.rendererName,
      antialias: profile.antialias,
      maxPixelRatio: profile.maxPixelRatio,
    };
  }

  /**
   * Erzeugt alle Koerper-Meshes und haengt sie an ihre Eltern.
   *
   * Planeten und die Sonne liegen flach in der Body-Gruppe (die Sonne im
   * Ursprung), Monde haengen als Kindobjekte an ihrem Planeten — sonst
   * wuerden sie nicht mit um den Planeten kreisen.
   *
   * @returns {void}
   */
  private addBodies(): void {
    // Zwei Durchlaeufe: erst Eltern, dann Monde, damit jeder Elternknoten
    // schon existiert, wenn ein Mond angehaengt wird.
    for (const body of this.bodies) {
      if (body.type === "moon") {
        continue;
      }
      const mesh = BodyFactory.create(
        body,
        this.options.scaleMode,
        this.options.distanceMode,
      );
      this.meshes.set(body.id, mesh);
      this.bodyGroup.add(mesh);
    }

    for (const body of this.bodies) {
      // Kleine, unbekannte Monde werden instanziert (siehe InstancedMoons) —
      // als eigenes Mesh wuerden sie hunderte Draw-Calls kosten.
      if (body.type !== "moon" || !isFeaturedMoon(body)) {
        continue;
      }
      const mesh = BodyFactory.create(
        body,
        this.options.scaleMode,
        this.options.distanceMode,
      );
      this.meshes.set(body.id, mesh);
      const parentMesh = body.parent === null ? undefined : this.meshes.get(body.parent);
      if (parentMesh === undefined) {
        this.bodyGroup.add(mesh);
      } else {
        parentMesh.add(mesh);
      }
    }

    this.addInstancedMoons();
    this.addRings();
  }

  /**
   * Erzeugt die instanzierten Mondgruppen und haengt sie an ihre Eltern.
   *
   * @returns {void}
   */
  private addInstancedMoons(): void {
    if (this.instancedMoons !== null) {
      this.instancedMoons.dispose();
      this.instancedMoons = null;
    }
    const radii = new Map<string, number>();
    for (const [id] of this.meshes) {
      radii.set(id, this.getBodyRadius(id) ?? 1);
    }
    const instanced = new InstancedMoons(
      this.bodies,
      radii,
      this.options.scaleMode,
    );
    instanced.attachTo(this.meshes);
    this.instancedMoons = instanced;
  }

  /**
   * Erzeugt die Ringsysteme und haengt sie an die Planeten-Meshes.
   *
   * @returns {void}
   */
  private addRings(): void {
    if (this.rings !== null) {
      this.rings.dispose();
      this.rings = null;
    }
    const rings = new Rings(this.bodies, this.options.scaleMode);
    rings.attachTo(this.meshes);
    this.rings = rings;
  }

  /**
   * Haengt die Mondbahnen an die aktuellen Eltern-Meshes.
   *
   * Muss nach jedem Neuaufbau der Koerper aufgerufen werden, weil die alten
   * Eltern-Meshes dabei verworfen werden.
   *
   * @returns {void}
   */
  private attachMoonOrbitLines(): void {
    if (this.orbitLines === null) {
      return;
    }
    for (const [parentId, line] of this.orbitLines.getMoonLines()) {
      const parentMesh = this.meshes.get(parentId);
      if (parentMesh === undefined) {
        continue;
      }
      parentMesh.add(line);
    }
  }

  /**
   * Erzeugt die Umlaufbahnlinien und haengt die Monde an ihre Eltern-Meshes.
   *
   * @returns {void}
   */
  private addOrbitLines(): void {
    this.orbitLines = new OrbitLines(this.bodies, this.options.distanceMode);
    this.scene.add(this.orbitLines.getObject());

    // Mondbahnen sind relativ zum Elternkoerper definiert und muessen daher
    // an dessen Mesh haengen, damit sie beim Umlauf mitwandern.
    this.attachMoonOrbitLines();
  }

  /**
   * Erzeugt den Asteroidenguertel samt Kometen und haengt ihn an die Szene.
   *
   * @returns {void}
   */
  private addBelt(): void {
    if (this.belt !== null) {
      this.belt.dispose();
      this.belt = null;
    }
    const belt = new Belt(this.options.distanceMode);
    this.scene.add(belt.getObject());
    this.belt = belt;
  }

  /**
   * Setzt Groesse und Orientierung des Canvas an die Fenstergroesse an.
   *
   * @returns {void}
   */
  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);

    this.camera.aspect = width / height;
    // Bei einem sehr flachen Fenster darf die Kamera nicht degenerieren.
    this.camera.updateProjectionMatrix();

    if (this.renderer !== null) {
      // Die Obergrenze kommt aus der Qualitaetsstufe, nicht aus einer
      // festen 2 — auf einem HiDPI-Handy wuerde Ratio 2 viermal so viele
      // Pixel zeichnen wie Ratio 1.
      this.renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, getQualityProfile(this.quality).maxPixelRatio),
      );
      this.renderer.setSize(width, height, false);
    }
  }

  /**
   * Setzt den Simulationszeitpunkt und aktualisiert alle Koerperpositionen.
   *
   * @param julianDate - Aktueller Zeitpunkt als Julian Date (z. B. 2460000.5).
   * @returns {void}
   * @throws {RangeError} Wenn `julianDate` nicht endlich ist.
   */
  setTime(julianDate: number): void {
    if (!Number.isFinite(julianDate)) {
      throw new RangeError(
        `julianDate muss eine endliche Zahl sein, ist aber ${String(julianDate)}.`,
      );
    }
    this.julianDate = julianDate;
    this.updateBodyTransforms();
  }

  /**
   * Berechnet und setzt Position und Eigenrotation aller Koerper.
   *
   * Die Positionen sind **lokal zum jeweiligen Eltern-Mesh**: Monde haengen
   * als Kindobjekte an ihrem Planeten, daher genuebt die Position relativ zum
   * Planeten (wie sie `orbitalPosition` liefert) — sie wandert dadurch von
   * selbst mit. Fuer die Umrechnung von Kilometern in Szeneneinheiten wird der
   * lineare Faktor `scaledAxis / semiMajorAxisKm` verwendet, damit die vom
   * nichtlinearen `scaleDistance` erzeugte Halbachse exakt getroffen wird.
   *
   * @returns {void}
   */
  private updateBodyTransforms(): void {
    for (const body of this.bodies) {
      const mesh = this.meshes.get(body.id);
      if (mesh === undefined) {
        continue;
      }

      // Die Sonne steht fest im Ursprung und braucht keine Umlaufbahn.
      if (body.type === "star" || body.semiMajorAxisKm <= 0) {
        mesh.position.set(0, 0, 0);
      } else {
        const state = orbitalPosition(body, this.julianDate);
        const scaledAxis = scaleDistance(
          body.semiMajorAxisKm,
          this.options.distanceMode,
        );
        const factor = scaledAxis / body.semiMajorAxisKm;
        mesh.position.set(
          state.position.x * factor,
          state.position.y * factor,
          state.position.z * factor,
        );
      }

      // Eigenrotation: negative Rotationsdauer ergibt retrograde Rotation.
      if (body.rotationPeriodH === 0) {
        mesh.rotation.y = 0;
      } else {
        const daysSinceJ2000 = this.julianDate - J2000_JULIAN_DATE;
        const degrees = (daysSinceJ2000 * 24 * 360) / body.rotationPeriodH;
        mesh.rotation.y = THREE.MathUtils.degToRad(degrees % 360);
      }
    }

    // Instanzierte Monde, Guertel und Kometen bewegen sich ohne eigenes Mesh
    // pro Koerper — sie brauchen nur die Kepler-Position pro Bild.
    this.instancedMoons?.update(this.julianDate, this.options.distanceMode);
    this.belt?.update(this.julianDate);
  }

  /**
   * Blendet kleine Monde ohne Kindtext aus ("Nur bekannte").
   *
   * Fuer Kinder soll die Szene uebersichtlich bleiben: im Modus `true` werden
   * nur die Koerper gezeigt, die auch in `facts.json` einen Kindtext haben —
   * das sind Sonne, Planeten und die bekannten Monde. Kleine, namenlose Monde
   * verschwinden.
   *
   * @param knownOnly - `true` blendet unbekannte Koerper aus.
   * @returns {void}
   */
  setKnownOnly(knownOnly: boolean): void {
    this.knownOnly = knownOnly;
    for (const body of this.bodies) {
      const mesh = this.meshes.get(body.id);
      if (mesh === undefined) {
        continue;
      }
      // Koerper, die ein eigenes Mesh haben (Sonne, Planeten, bekannte Monde),
      // werden nie ausgeblendet.
      mesh.visible = !knownOnly || isFeaturedMoon(body) || body.type !== "moon";
    }
    if (this.instancedMoons !== null) {
      this.instancedMoons.setVisible(!knownOnly);
    }
  }

  /**
   * Liefert, ob der Detailfilter "Nur bekannte" aktiv ist.
   *
   * @returns `true`, wenn unbekannte Koerper ausgeblendet sind.
   */
  isKnownOnly(): boolean {
    return this.knownOnly;
  }

  /**
   * Wechselt den Radius-Skalierungsmodus und baut die Koerper neu auf.
   *
   * @param mode - Neuer Modus.
   * @returns {void}
   */
  setScaleMode(mode: ScaleMode): void {
    if (this.options.scaleMode === mode) {
      return;
    }
    this.options = { ...this.options, scaleMode: mode };
    this.rebuildBodies();
  }

  /**
   * Wechselt den Distanz-Skalierungsmodus und baut Szene neu auf.
   *
   * @param mode - Neuer Modus.
   * @returns {void}
   */
  setDistanceMode(mode: DistanceMode): void {
    if (this.options.distanceMode === mode) {
      return;
    }
    this.options = { ...this.options, distanceMode: mode };
    this.rebuildBodies();
    this.rebuildOrbitLines();
    this.belt?.setDistanceMode(mode);
  }

  /**
   * Verwirft Koerper-Meshes und erzeugt sie im aktuellen Modus neu.
   *
   * @returns {void}
   */
  private rebuildBodies(): void {
    for (const mesh of this.meshes.values()) {
      BodyFactory.dispose(mesh);
    }
    this.meshes.clear();
    this.bodyGroup.clear();
    this.addBodies();
    // Die alten Eltern-Meshes sind weg — die Mondbahnen muessen neu haengen.
    this.attachMoonOrbitLines();
    this.updateBodyTransforms();
  }

  /**
   * Verwirft die Umlaufbahnlinien und erzeugt sie neu.
   *
   * @returns {void}
   */
  private rebuildOrbitLines(): void {
    if (this.orbitLines === null) {
      this.addOrbitLines();
      return;
    }
    this.orbitLines.dispose();
    this.orbitLines = null;
    this.addOrbitLines();
  }

  /**
   * Zeichnet ein Bild und bewegt die Kamera weich auf ihr Ziel zu.
   *
   * @returns {void}
   */
  render(): void {
    if (this.renderer === null) {
      return;
    }
    this.updateCamera();
    this.updateLod();
    this.rings?.update(this.camera.position);
    this.instancedMoons?.updateLod(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Aktualisiert die Detailstufe aller Koerper-Meshes anhand der Kamera.
   *
   * Der Wechsel passiert nur, wenn sich die Stufe tatsaechlich aendert
   * (Hysterese in `scene/LodCache`) — sonst wuerde die Geometrie bei jeder
   * kleinen Kamerabewegung getauscht (Flackern + GC-Druck).
   *
   * @returns {void}
   */
  private updateLod(): void {
    for (const mesh of this.meshes.values()) {
      // Nur Meshes mit gesetzter Radius-/Stufen-Information sind LOD-faehig.
      // Die Bedingung wird vor dem Aufruf geprueft, damit nicht pro Bild eine
      // Ausnahme fuer ungueltige Daten erzeugt wird.
      if (
        typeof mesh.userData["bodyRadius"] !== "number" ||
        typeof mesh.userData["lodLevel"] !== "string"
      ) {
        continue;
      }
      applyLodByDistance(mesh, this.camera.position);
    }
  }

  /**
   * Interpoliert die Kamera weich auf das Ziel.
   *
   * @returns {void}
   */
  private updateCamera(): void {
    const easing = 0.08;
    this.camera.position.x += (this.cameraTarget.x - this.camera.position.x) * easing;
    this.camera.position.y += (this.cameraTarget.y - this.camera.position.y) * easing;
    this.camera.position.z += (this.cameraTarget.z - this.camera.position.z) * easing;
    this.camera.lookAt(this.lookTarget.x, this.lookTarget.y, this.lookTarget.z);
  }

  /**
   * Liefert eine Textbeschreibung der Szenenstruktur — fuer Determinismus-
   * Tests und Fehlersuche.
   *
   * Enthaelt fuer jeden Koerper die Weltposition und die Szenengroesse, in
   * fester Reihenfolge. Zwei Aufrufe der App muessen exakt denselben String
   * liefern — das ist der Nachweis, dass nirgends `Math.random()` in die
   * Szeneninitialisierung geraten ist.
   *
   * **Wichtig fuer den Vergleich:** die Koerper bewegen sich, und die App
   * rechnet die Simulationszeit im Zeitraffer hoch. Zwei Seitenaufrufe
   * stehen deshalb nie exakt beim selben Zeitpunkt. Deshalb wird die
   * Zeit vor dem Vergleich auf einen festen Wert gesetzt (`atJulianDate`),
   * wenn der Aufrufer einen angibt — sonst waere der Test der Zeitraffer-
   * Geschwindigkeit und nicht der Determinismus der Szene.
   *
   * Die Zahlen sind auf 4 Nachkommastellen gerundet: Gleitkomma-
   * Reihenfolgeunterschiede zwischen zwei Laeufen sollen nicht als
   * Zufall gewertet werden, sind aber nicht der Determinismus, den wir
   * pruefen wollen.
   *
   * @param atJulianDate - Optional: Simulationszeit, auf die vor dem
   *   Auslesen gesetzt wird (z. B. J2000). Ohne diesen Wert wird der
   *   aktuelle Zeitpunkt genommen (nur fuer Fehlersuche sinnvoll).
   * @returns Ein stabiler, vergleichbarer Schnappschuss der Szene.
   */
  snapshot(atJulianDate?: number): string {
    if (atJulianDate !== undefined) {
      this.setTime(atJulianDate);
    }
    const r4 = (value: number): string => value.toFixed(4);
    const parts: string[] = [
      `quality=${this.quality}`,
      `bodies=${this.bodies.length}`,
      `time=${r4(this.julianDate)}`,
    ];
    const world = new THREE.Vector3();
    for (const body of this.bodies) {
      const mesh = this.meshes.get(body.id);
      if (mesh !== undefined) {
        mesh.getWorldPosition(world);
        parts.push(
          `${body.id}|${r4(world.x)},${r4(world.y)},${r4(world.z)}|s=${r4(mesh.scale.x)}`,
        );
      } else {
        // Instanzierte Koerper: Position aus den Instanzdaten.
        parts.push(`${body.id}|instanziert`);
      }
    }
    if (this.instancedMoons !== null) {
      parts.push(`instanced=${this.instancedMoons.count}`);
      parts.push(`groups=${this.instancedMoons.groupCount}`);
    }
    if (this.belt !== null) {
      const belt = this.belt.getStats();
      parts.push(`belt=${belt.asteroids},${belt.comets},${belt.innerAu},${belt.outerAu}`);
      parts.push(`beltSample=${this.belt.sampleSnapshot(8)}`);
    }
    if (this.orbitLines !== null) {
      parts.push(`orbitPlanets=${this.orbitLines.getPlanetBodyIds().join(",")}`);
      parts.push(`orbitMoonGroups=${[...this.orbitLines.getMoonLines().keys()].join(",")}`);
    }
    parts.push(`rings=${this.rings?.count ?? 0}`);
    parts.push(`stars=${this.starfield?.getCount() ?? 0}`);
    return parts.join("\n");
  }

  /**
   * Richtet die Kamera auf einen Koerper aus.
   *
   * Die Kamera faehrt weich an (per Lerp in {@link SceneManager.render}); wenn
   * der aktuell eingefrorene Bildausschnitt zu weit weg waere, wird sie
   * zusaetzlich hart an die Zielposition gesetzt, damit `focusOn` auch ohne
   * Animationsschleife sofort wirkt.
   *
   * @param bodyId - ID des Koerpers (z. B. `"mars"`).
   * @param distanceFactor - Vielfaches des Koerperradius als Kameraabstand;
   *   Standard ist {@link DEFAULT_FOCUS_FACTOR}.
   * @returns {void}
   * @throws {RangeError} Wenn `bodyId` unbekannt ist oder `distanceFactor` <= 0.
   */
  focusOn(bodyId: string, distanceFactor: number = DEFAULT_FOCUS_FACTOR): void {
    const body = this.bodies.find((entry) => entry.id === bodyId);
    if (body === undefined) {
      throw new RangeError(`Unbekannter Koerper: ${bodyId}`);
    }
    if (!Number.isFinite(distanceFactor) || distanceFactor <= 0) {
      throw new RangeError(
        `distanceFactor muss positiv sein, ist aber ${String(distanceFactor)}.`,
      );
    }

    const mesh = this.meshes.get(bodyId);
    if (mesh === undefined) {
      return;
    }

    // Monde haengen als Kindobjekte am Planeten: `mesh.position` ist dann nur
    // die Position relativ zum Elternkoerper. Fuer die Kamera brauchen wir die
    // Weltposition, sonst zielt sie ins Leere.
    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);

    const radius = scaleRadius(body.radiusKm, this.options.scaleMode);
    const distance = Math.max(radius * distanceFactor, DISTANCE_NEAR);

    // Blickziel ist der Koerper selbst …
    this.lookTarget = { x: world.x, y: world.y, z: world.z };

    // … die Kamera fahrt davor. Wichtig: Das Ziel fuer die weiche Fahrt ist
    // die Kameraposition selbst, nicht der Koerpermittelpunkt — sonst faehrt
    // die Kamera im Laufe der Interpolation *in* den Planeten hinein.
    this.cameraTarget = {
      x: world.x,
      y: world.y + distance * 0.5,
      z: world.z + distance,
    };
  }

  /**
   * Liefert Laufzeitstatistik der Szene.
   *
   * Die Zahlen stammen aus `renderer.info` und beziehen sich auf den letzten
   * gezeichneten Frame (vor dem ersten `render` also auf Null).
   *
   * @returns Anzahl der Koerper, Zeichenaufrufe und Dreiecke.
   */
  getStats(): SceneStats {
    const info = this.renderer?.info;
    const stats: SceneStats = {
      // `bodies` zaehlt alle Koerper, auch die instanzierten — die sind ja
      // sichtbar, nur ohne eigenes Mesh.
      bodies: this.bodies.length,
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
    };
    if (this.instancedMoons !== null) {
      stats.instancedMoons = this.instancedMoons.count;
    }
    if (this.belt !== null) {
      stats.asteroids = this.belt.getStats().asteroids;
    }
    if (this.rings !== null) {
      stats.rings = this.rings.count;
    }
    return stats;
  }

  /**
   * Liefert die Three.js-Szene (z. B. fuer Tests oder Debug-Overlays).
   *
   * @returns Die Szene.
   */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Liefert die Kamera.
   *
   * @returns Die Perspektivkamera.
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  /**
   * Liefert den Radius eines Koerpers im aktuellen Szenemass.
   *
   * @param bodyId - ID des Koerpers.
   * @returns Radius in Szeneneinheiten, oder `null` bei unbekanntem Koerper.
   */
  getBodyRadius(bodyId: string): number | null {
    const body = this.bodies.find((entry) => entry.id === bodyId);
    if (body === undefined) {
      return null;
    }
    return safeRenderRadius(body, this.options.scaleMode);
  }

  /**
   * Liefert die IDs aller Koerper der Szene, auch der instanzierten Monde.
   *
   * @returns Die Koerper-IDs in der Reihenfolge von `bodies.json`.
   */
  getBodyIds(): readonly string[] {
    return this.bodies.map((body) => body.id);
  }

  /**
   * Liefert die Weltposition eines Koerpers, auch fuer instanzierte Monde.
   *
   * Kleine, unbekannte Monde haben aus Performance-Gruenden kein eigenes
   * Mesh, sondern stecken als Instanz in einem `InstancedMesh`. Ihr
   * Weltpunkt steckt daher nur in der Instanzmatrix. Ohne diese Abfrage
   * waeren 449 der 456 Monde in der Navigation sichtbar, aber nicht
   * anwaehlbar — die Kamera wuesste nicht, wohin sie fliegen soll.
   *
   * @param bodyId - ID des Koerpers.
   * @param out - Zielvektor; wird in-place gefuellt.
   * @returns `true`, wenn eine Position ermittelt werden konnte.
   */
  getBodyWorldPosition(bodyId: string, out: THREE.Vector3): boolean {
    const object = this.meshes.get(bodyId);
    if (object !== undefined) {
      object.getWorldPosition(out);
      return true;
    }
    if (this.instancedMoons !== null && this.instancedMoons.positionOf(bodyId, out)) {
      return true;
    }
    return false;
  }

  /**
   * Loest alle Geometrien, Materialien und Listener auf.
   *
   * Nach diesem Aufruf ist der Manager unbrauchbar; `dispose` ist idempotent.
   *
   * @returns {void}
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    window.removeEventListener("resize", this.onResize);

    if (this.orbitLines !== null) {
      this.orbitLines.dispose();
      this.orbitLines = null;
    }
    if (this.rings !== null) {
      this.rings.dispose();
      this.rings = null;
    }
    if (this.instancedMoons !== null) {
      this.instancedMoons.dispose();
      this.instancedMoons = null;
    }
    if (this.belt !== null) {
      this.belt.dispose();
      this.belt = null;
    }
    if (this.starfield !== null) {
      this.starfield.dispose();
      this.starfield = null;
    }
    for (const mesh of this.meshes.values()) {
      BodyFactory.dispose(mesh);
    }
    this.meshes.clear();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = (object as THREE.Mesh).material;
        if (Array.isArray(material)) {
          for (const entry of material) {
            entry.dispose();
          }
        } else {
          material.dispose();
        }
      }
    });
    this.scene.clear();

    // Die geteilten LOD-Geometrien werden hier zentral freigegeben — vorher
    // haetten die obigen `dispose`-Aufrufe sie bereits mitgenommen, was
    // zulaessig, aber undokumentiert waere. `disposeLodGeometries` leert
    // zusaetzlich den Cache, damit ein neuer Aufbau wieder frisch beginnt.
    disposeLodGeometries();

    if (this.renderer !== null) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  /**
   * Liefert den aktuell simulierten Zeitpunkt.
   *
   * @returns Julian Date der Szene.
   */
  getJulianDate(): number {
    return this.julianDate;
  }

  /**
   * Liefert den Epoch-Bezug der Simulation (J2000 als Julian Date).
   *
   * @returns {number} Julian Date von J2000.
   */
  static getEpochJulianDate(): number {
    return J2000_JULIAN_DATE;
  }

  /**
   * Liefert den J2000-Epochenzeitpunkt als Unix-Millisekunden.
   *
   * @returns {number} Unix-Zeitstempel in Millisekunden.
   */
  static getEpochUnixMs(): number {
    return J2000_UNIX;
  }
}
