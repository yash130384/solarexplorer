/**
 * Integration des SolarExplorers.
 *
 * Diese Datei ist die einzige Stelle, die Szene, Schiff, Steuerung, Kamera
 * und Benutzeroberflaeche miteinander verdrahtet. `src/main.ts` bleibt ein
 * reiner Bootstrap (Canvas finden, App starten, `dispose` registrieren).
 *
 * Reihenfolge des Aufbaus in {@link SolarExplorerApp.start}:
 * Daten laden -> URL-Modi lesen -> Szene -> Schiff/Steuerung/Kamera ->
 * Benutzeroberflaeche -> Resize-Handler -> Bildschleife.
 *
 * @module app
 */

import * as THREE from "three";
import "./ui/styles.css";

import { SECONDS_PER_DAY, SUN_RADIUS_KM } from "./core/constants";
import { getScaleModeFromUrl } from "./core/orbital";
import { scaleRadius, timeScaleFor } from "./core/scale";
import type { DistanceMode, ScaleMode, TimePreset } from "./core/scale";
import { CameraFollow } from "./controls/CameraFollow";
import { ShipControls } from "./controls/ShipControls";
import { SceneManager } from "./scene/SceneManager";
import { Ship } from "./scene/Ship";
import type { BloomMode, FrameRegion, FrameSample } from "./scene/types";
import { HudUI } from "./ui/Hud";
import type { DistanceScaleMode, ShipStatus, SizeScaleMode } from "./ui/Hud";
import { InfoPanelUI, fetchJson } from "./ui/InfoPanel";
import type { BodiesFile, BodyData } from "./ui/InfoPanel";
import { NavUI } from "./ui/Nav";
import { QuizUI } from "./ui/Quiz";

/**
 * Basis-URLs, unter denen die JSON-Dateien gesucht werden.
 *
 * Reihenfolge: `"."` deckt die flache Kopie aus `publicDir: "src/data"` ab —
 * Vite legt Dateien aus dem publicDir in die Wurzel von `dist/` (und des
 * Dev-Servers), nicht in `dist/data/`. `./data` ist der urspruengliche
 * Wunschpfad und `./src/data` der Quellpfad; sie stehen als Rueckfalloption
 * dahinter, weil der Build nur `"."` kennt.
 *
 * Wichtig ist die Reihenfolge: mit `"./data"` vorne schlaegt der Browser bei
 * jedem Start einen 404 fuer `/data/bodies.json` und `/data/facts.json` an —
 * die App startet zwar ueber den Fallback, aber die Konsole zeigt zwei Fehler.
 * Deshalb wird zuerst der Pfad probiert, der im gebauten Bundle existiert.
 */
const DATA_BASE_URLS: readonly string[] = [".", "./data", "./src/data"];

/**
 * Obergrenze fuer `deltaSeconds` je Bild.
 *
 * Nach einem Tab-Wechsel liefert `requestAnimationFrame` einen riesigen
 * Zeitsprung; ohne Deckel wuerde die Simulation um Sekunden vorspringen und
 * das Schiff durch alle Planeten hindurchfliegen.
 */
const MAX_FRAME_DELTA_SECONDS = 0.1;

/** Abstand, in dem das Schiff startet: dreifacher Sonnenradius. */
const SHIP_START_FACTOR = 3;

/** Vielfaches des Koerperradius als Startabstand beim Anflug. */
const FOCUS_APPROACH_FACTOR = 4;

/** Voreingestellter Zeitraffer beim Start. */
const DEFAULT_TIME_PRESET: TimePreset = "days";

/** Beschriftung des Quiz-Knopfes im nicht laufenden Zustand. */
const QUIZ_START_LABEL = "Quiz starten";

/** Beschriftung des Quiz-Knopfes im laufenden Zustand. */
const QUIZ_STOP_LABEL = "Quiz beenden";

/** Gueltige Distanzmodi — Spiegel von `DistanceMode` aus `core/scale`. */
const DISTANCE_MODES: readonly DistanceMode[] = ["visual", "real", "log"];

/** Gueltige Bloom-Modi — Spiegel von `BloomMode` aus `scene/types`. */
const BLOOM_MODES: readonly BloomMode[] = ["auto", "on", "off"];

/**
 * Liest den Wert eines einzelnen Query-String-Schluessels aus.
 *
 * @param search - Query-String, mit oder ohne fuehrendes `?`.
 * @param key - Gesuchter Schluessel, z. B. `"distance"`.
 * @returns Der kleingeschriebene Wert, oder `null` wenn nicht vorhanden.
 */
function readUrlParam(search: string, key: string): string | null {
  if (typeof search !== "string") {
    return null;
  }
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const part of query.split("&")) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf("=");
    if (eq < 0) {
      continue;
    }
    if (part.slice(0, eq) !== key) {
      continue;
    }
    return decodeURIComponent(part.slice(eq + 1)).trim().toLowerCase();
  }
  return null;
}

/**
 * Liest den Distanzmodus aus einer Query-Strings.
 *
 * `core/orbital.ts` liefert nur den Parser fuer `?scale=`; fuer `?distance=`
 * gibt es dort bewusst keinen. Diese kleine Ergaenzung haelt die URL-Logik
 * vollstaendig in der Integrationsschicht.
 *
 * @param search - Query-String, mit oder ohne fuehrendes `?`.
 * @returns Der angeforderte Modus, sonst `'visual'`.
 */
function getDistanceModeFromUrl(search: string): DistanceMode {
  const match = DISTANCE_MODES.find((mode) => mode === readUrlParam(search, "distance"));
  return match ?? "visual";
}

/**
 * Liest den Bloom-Modus (`?bloom=auto|on|off`) aus der Query-Strings.
 *
 * Praktisch wichtig fuer den Nachweis: der Test laeuft auf einem headless-
 * Chromium, also auf einem Software-Rasterisierer, wo `auto` den Glanz
 * abschaltet. Mit `?bloom=on` laesst sich der Effekt dort erzwingen.
 *
 * @param search - Query-String, mit oder ohne fuehrendes `?`.
 * @returns Der angeforderte Modus, sonst `'auto'`.
 */
function getBloomModeFromUrl(search: string): BloomMode {
  const match = BLOOM_MODES.find((mode) => mode === readUrlParam(search, "bloom"));
  return match ?? "auto";
}

/**
 * Liest den Modus der Oberflaechen-Texturen aus der Query-Strings.
 *
 * Nur fuer den Nachweis gedacht: `?textures=off` laesst die Koerper
 * einfarbig, damit ein Test **an derselben Stelle** beweisen kann, dass die
 * Textur das Bild ueberhaupt veraendert (siehe `tests/e2e/texture-pixels`).
 *
 * @param search - Query-String, mit oder ohne fuehrendes `?`.
 * @returns `false` nur bei `textures=off`, sonst `true`.
 */
function getTexturesFromUrl(search: string): boolean {
  return readUrlParam(search, "textures") !== "off";
}

/**
 * Bildet den Skalierungsmodus der Szene auf die Anzeige des HUD ab.
 *
 * Das HUD kennt nur `visual` und `real`; `compact` wird als `visual`
 * dargestellt, weil es dieselbe logarithmische Familie ist.
 *
 * @param mode - Skalierungsmodus der Szene.
 * @returns Der entsprechende HUD-Modus.
 */
function toHudSizeMode(mode: ScaleMode): SizeScaleMode {
  return mode === "real" ? "real" : "visual";
}

/**
 * Bildet den Distanzmodus der Szene auf die Anzeige des HUD ab.
 *
 * @param mode - Distanzmodus der Szene.
 * @returns Der entsprechende HUD-Modus.
 */
function toHudDistanceMode(mode: DistanceMode): DistanceScaleMode {
  return mode === "real" ? "real" : "visual";
}

/**
 * Laedt `bodies.json` und `facts.json` parallel und parallel-fehltolerant.
 *
 * Beide Dateien werden gleichzeitig angefragt (das geforderte `Promise.all`),
 * jede ueber die Liste der Basis-URLs aus {@link DATA_BASE_URLS}. Erst wenn
 * kein Basis-Pfad antwortet, wird der Fehler weitergegeben.
 *
 * @returns Die geladene Koerperliste und die Basis-URL, unter der sie lag.
 * @throws {Error} Wenn keine der Basis-URLs auswertbare Daten liefert.
 */
async function loadDataFiles(): Promise<{
  readonly bodies: readonly BodyData[];
  readonly baseUrl: string;
}> {
  let lastError: unknown = null;
  for (const base of DATA_BASE_URLS) {
    try {
      const [bodiesFile] = await Promise.all([
        fetchJson<BodiesFile>(`${base}/bodies.json`),
        fetchJson<unknown>(`${base}/facts.json`),
      ]);
      if (!Array.isArray(bodiesFile.bodies)) {
        throw new Error(`${base}/bodies.json enthaelt kein 'bodies'-Array.`);
      }
      return { bodies: bodiesFile.bodies, baseUrl: base };
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Die Datendateien konnten nicht geladen werden.");
}

/**
 * Zeigt eine freundliche deutsche Fehlermeldung im DOM an.
 *
 * Bewusst kein `alert()` und kein `console.error` allein: die Seite soll fuer
 * ein Kind erklaeren, was los ist, und nicht leer bzw. unerklaert bleiben.
 *
 * @param root - Container, in dem die Meldung erscheint.
 * @param title - Kurze Ueberschrift.
 * @param detail - Ausfuehrlichere Erklaerung fuer die Kinder.
 * @returns {void}
 */
function showFatalError(root: HTMLElement, title: string, detail: string): void {
  const wrapper = document.createElement("div");
  wrapper.className = "se-fatal";
  wrapper.setAttribute("role", "alert");
  wrapper.dataset["testid"] = "app-error";

  const heading = document.createElement("h1");
  heading.className = "se-fatal__title";
  heading.textContent = title;

  const message = document.createElement("p");
  message.className = "se-fatal__text";
  message.textContent = detail;

  wrapper.append(heading, message);
  root.replaceChildren(wrapper);
}

/**
 * Verdrahtet Szene, Schiff, Steuerung, Kamera und Benutzeroberflaeche.
 */
export class SolarExplorerApp {
  /** Das Canvas, in das die 3D-Szene gerendert wird. */
  private readonly canvas: HTMLCanvasElement;

  /** Container, in den Canvas und Benutzeroberflaeche gehaengt werden. */
  private readonly root: HTMLElement;

  /** Die Three.js-Szene. */
  private scene: SceneManager | null = null;

  /** Das Raumschiff. */
  private ship: Ship | null = null;

  /** Tastatur-, Maus- und Touchsteuerung des Schiffs. */
  private controls: ShipControls | null = null;

  /** Kamerasteuerung, die dem Schiff folgt. */
  private camera: CameraFollow | null = null;

  /** Statusanzeige. */
  private hud: HudUI | null = null;

  /** Navigationsliste der Koerper. */
  private nav: NavUI | null = null;

  /** Seitenpanel mit den Koerperdaten. */
  private panel: InfoPanelUI | null = null;

  /** Lernquiz. */
  private quiz: QuizUI | null = null;

  /** Startknopf des Quiz, von der Integration erzeugt. */
  private quizButton: HTMLButtonElement | null = null;

  /** `true`, solange das Quiz laeuft. */
  private quizActive = false;

  /** Aktueller Simulationszeitpunkt als Julian Date. */
  private julianDate: number = SceneManager.getEpochJulianDate();

  /** Aktiver Radius-Skalierungsmodus. */
  private scaleMode: ScaleMode = "visual";

  /** Aktiver Distanz-Skalierungsmodus. */
  private distanceMode: DistanceMode = "visual";

  /** Aktiver Bloom-Modus des Sonnen-Glanzes. */
  private bloomMode: BloomMode = "auto";

  /** `false` laesst die Koerper einfarbig (`?textures=off`, Nachweis only). */
  private texturesEnabled = true;

  /** Simulationssekunden je Echtzeitsekunde. */
  private timeScale: number = timeScaleFor(DEFAULT_TIME_PRESET);

  /** `true`, wenn die Simulation angehalten ist. */
  private paused = false;

  /** Aktuell gewaehlter Koerper fuer Navigation und Datenpanel. */
  private activeBodyId: string | null = null;

  /** Aktueller Stand der Schnellreise-Ziele (als Julian Date). */
  private lastQuickTravelDate = -Infinity;

  /** ID des laufenden `requestAnimationFrame`, zum Abbrechen in `dispose`. */
  private frameHandle: number | null = null;

  /** Zeitstempel des letzten Bildes in Millisekunden. */
  private lastFrameMs = 0;

  /** Geglaettete Bildrate fuer die HUD-Anzeige. */
  private fps = 0;

  /** Verhindert doppelten Aufbau und macht `dispose` idempotent. */
  private disposed = false;

  /** Handler fuer `resize`, wird in `dispose` wieder entfernt. */
  private readonly onWindowResize: () => void;

  /** Handler fuer `keydown`, wird in `dispose` wieder entfernt. */
  private readonly onWindowKeyDown: (event: KeyboardEvent) => void;

  /**
   * Merkt sich die Positionen aller Koerper fuer die Schnellreise (M/F).
   *
   * @returns Zuordnung von Koerper-ID zu Weltposition in Szeneneinheiten.
   */
  private quickTravelPositions: Map<string, THREE.Vector3> = new Map();

  /**
   * Erzeugt die App, baut aber noch nichts auf.
   *
   * Der Aufbau erfolgt bewusst erst in {@link SolarExplorerApp.start}, damit
   * der Konstruktor auch ohne WebGL und ohne Netzwerk aufrufbar bleibt.
   *
   * @param canvas - Das Ziel-Canvas der 3D-Szene.
   * @throws {TypeError} Wenn `canvas` kein HTMLCanvasElement ist.
   */
  constructor(canvas: HTMLCanvasElement) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError("SolarExplorerApp braucht ein HTMLCanvasElement.");
    }
    this.canvas = canvas;
    // In index.html liegt das Canvas als Geschwister von #app; die UI soll
    // nach #app, nicht in <body>.
    this.root = document.querySelector<HTMLElement>("#app") ?? canvas.parentElement ?? document.body;
    this.applyCanvasLayout();
    this.onWindowResize = (): void => {
      this.scene?.resize();
    };
    this.onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      // Leertaste ist bereits im HUD belegt; P und Q kommen aus der Integration.
      if (event.code === "KeyP") {
        event.preventDefault();
        this.togglePause();
      } else if (event.code === "KeyQ") {
        event.preventDefault();
        this.toggleQuiz();
      }
    };
  }

  /**
   * Laedt die Daten und baut die gesamte Anwendung auf.
   *
   * Schlaegt der Start fehl, wird eine freundliche deutsche Meldung im DOM
   * angezeigt und der Fehler weitergereicht, damit `main.ts` ihn ebenfalls
   * abfangen kann.
   *
   * @returns {Promise<void>} Fertig, sobald die erste Frame-Schleife laeuft.
   * @throws {Error} Wenn `bodies.json` oder `facts.json` nicht ladbar sind.
   */
  async start(): Promise<void> {
    if (this.disposed) {
      throw new Error("SolarExplorerApp wurde bereits disposed.");
    }

    let bodies: readonly BodyData[];
    let dataBaseUrl: string;
    try {
      const loaded = await loadDataFiles();
      bodies = loaded.bodies;
      dataBaseUrl = loaded.baseUrl;
    } catch (cause) {
      showFatalError(
        this.root,
        "Die Sterne sind gerade nicht erreichbar",
        "SolarExplorer konnte die Dateien mit den Planeten nicht laden. Bitte pruefe, " +
          "ob die Internetverbindung steht, und lade die Seite neu.",
      );
      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    // Skalierungsmodi aus der URL lesen (core/orbital.ts bzw. lokaler Parser).
    this.scaleMode = getScaleModeFromUrl(window.location.search);
    this.distanceMode = getDistanceModeFromUrl(window.location.search);
    this.bloomMode = getBloomModeFromUrl(window.location.search);
    this.texturesEnabled = getTexturesFromUrl(window.location.search);

    this.buildScene();
    await this.buildShip();
    this.buildUi(bodies, dataBaseUrl);

    this.exposeDebugHook();

    window.addEventListener("resize", this.onWindowResize);
    window.addEventListener("keydown", this.onWindowKeyDown);

    this.startLoop();
  }

  /**
   * Legt einen Debug-Hook unter `window.__solarExplorer` ab.
   *
   * Der E2E-Performance-Test braucht die echten Zahlen aus der laufenden
   * Szene (Draw-Calls, Dreiecke, Bildrate) — und zwar aus dem *gebauten*
   * Bundle, nicht aus einer nachgebauten Szene im Test. Der Hook ist rein
   * lesend und aendert nichts an der Simulation.
   *
   * @returns {void}
   */
  private exposeDebugHook(): void {
    const app = this;
    (window as unknown as Record<string, unknown>)["__solarExplorer"] = {
      /**
       * Liefert die aktuellen Szenen- und Bildstatistiken.
       *
       * @returns Statistik aus `SceneManager.getStats()` plus FPS und
       *   Koerperzahl der App.
       */
      getStats: () => {
        const stats = app.scene?.getStats() ?? null;
        return {
          bodies: stats?.bodies ?? 0,
          drawCalls: stats?.drawCalls ?? 0,
          triangles: stats?.triangles ?? 0,
          instancedMoons: stats?.instancedMoons ?? 0,
          asteroids: stats?.asteroids ?? 0,
          rings: stats?.rings ?? 0,
          textured: stats?.textured ?? 0,
          fps: app.fps,
          quality: app.scene?.getQuality() ?? null,
          bloom: app.scene?.getSunGlowSettings() ?? null,
        };
      },
      /**
       * Schaltet den Sonnen-Glanz (Bloom) um, ohne die Szene neu aufzubauen.
       *
       * @param mode - `"on"`, `"off"` oder `"auto"` (folgt der Hardware).
       * @returns {void}
       */
      setBloomMode: (mode: BloomMode) => {
        app.bloomMode = mode;
        app.scene?.setBloomMode(mode);
      },
      /**
       * Haelt die Simulation an oder laesst sie weiterlaufen.
       *
       * Wird von den Bildmessungen genutzt: die Asteroiden wandern weiter,
       * und zwei Messungen zu verschiedenen Zeitpunkten sind nicht
       * vergleichbar.
       *
       * @param value - `true` haelt an.
       * @returns {void}
       */
      setPaused: (value: boolean) => {
        app.paused = value;
        app.updateHud();
      },
      /**
       * Misst die Helligkeit eines Bildausschnitts im naechsten gerenderten
       * Bild (Nachweis des Sonnen-Glanzes, siehe `scene/types`).
       *
       * @param region - Rechteck in CSS-Pixeln ab der linken oberen Ecke.
       * @returns Promise mit den Messwerten des naechsten Bildes.
       */
      sampleFrame: (region: FrameRegion): Promise<FrameSample> =>
        app.scene?.sampleFrame(region) ?? Promise.resolve({
          maxLuminance: 0,
          meanLuminance: 0,
          brightPixels: 0,
          corePixels: 0,
          totalPixels: 0,
        }),
      /**
       * Schaltet den Detailfilter um (fuer Tests der Kindersicht).
       *
       * @param knownOnly - `true` blendet unbekannte Koerper aus.
       * @returns {void}
       */
      setKnownOnly: (knownOnly: boolean) => {
        app.scene?.setKnownOnly(knownOnly);
        app.hud?.setDetailMode(knownOnly ? 'known' : 'all');
      },
      /**
       * Setzt die Kamera **sofort** an einen Koerper — ohne weiche Fahrt.
       *
       * Nur fuer Bildmessungen (Nachweis der Texturen). Zwei Aufnahmen, die
       * pixelgleich verglichen werden, muessen exakt dieselbe Kamera haben:
       * die weiche Fahrt aus `CameraFollow.update` und der weiche Lerp in
       * `SceneManager.updateCamera` lassen den Planeten zwischen den
       * Aufnahmen wandern, und der Vergleich masste dann die Kamerafahrt.
       *
       * Deshalb wird die Kamera zuerst aus der Schiffsverfolgung geloest —
       * sonst zieht `CameraFollow` sie im naechsten Bild wieder aufs Schiff
       * zurueck, und genau daran ist die erste Fassung des Nachweises
       * gescheitert (gemessen wurde ein Planetenrand statt der Scheibe).
       *
       * @param bodyId - ID des Koerpers, z. B. `"venus"`.
       * @param distanceFactor - Kameraabstand als Vielfaches des Radius.
       * @returns {void}
       */
      focusBodyInstant: (bodyId: string, distanceFactor?: number): void => {
        // `free` ist der Modus ohne Ziel: `update` kehrt dann sofort zurueck
        // und laesst die Kamera stehen.
        app.camera?.setMode("free");
        app.camera?.setTarget(null);
        app.scene?.focusOn(bodyId, distanceFactor, true);
      },
      /**
       * Setzt die Simulationszeit **dauerhaft**.
       *
       * `snapshot(epoch)` allein reicht nicht: `App.tick` ruft in jedem Bild
       * `scene.setTime(app.julianDate)` auf und setzt die Zeit damit sofort
       * wieder auf den Wert der App. Der Koerper wanderte also weiter, und
       * zwei Aufnahmen "derselben" Szene zeigten verschiedene Standorte —
       * gemessen wurde die Bewegung statt der Textur (Kontrollmessung auf
       * dem Jupiter: 12 bis 20 % veraenderte Pixel ohne jede Textur).
       *
       * @param julianDate - Simulationszeit als Julian Date, z. B. J2000.
       * @returns {void}
       */
      setEpoch: (julianDate: number): void => {
        app.julianDate = julianDate;
        app.scene?.setTime(julianDate);
      },
      /**
       * Liefert das Rechteck, in dem ein Koerper aktuell auf dem Bildschirm
       * liegt — in CSS-Pixeln des Canvas.
       *
       * Nur fuer Bildmessungen. Der Textur-Nachweis muss das Messfeld auf die
       * *sichtbare* Scheibe legen; vorher wurde die Feldgroesse aus Radius
       * und Kameraabstand hochgerechnet, und weil `focusOn` den Abstand bei
       * `DISTANCE_NEAR` klemmt, lag das Feld bei Erde, Mars, Uranus und
       * Neptun grossenteils neben dem Koerper (gemessene Aenderung dort:
       * 0.0 bis 0.8 %, auf dem Jupiter dagegen 3.9 %).
       *
       * Statt zu rechnen wird der Radius ueber die echte Kamera projiziert:
       * das uebernimmt Near/Far, FOV und den Zoom der laufenden Szene.
       *
       * @param bodyId - ID des Koerpers, z. B. `"jupiter"`.
       * @param marginFraction - Zuschlag um den Radius, z. B. `0.15` fuer
       *   15 % mehr Kantenlaenge je Seite.
       * @returns Das Rechteck, oder `null`, wenn der Koerper nicht
       *   gefunden werden konnte.
       */
      bodyScreenRect: (
        bodyId: string,
        marginFraction = 0.15,
      ): { x: number; y: number; width: number; height: number } | null => {
        const scene = app.scene;
        if (scene === null) {
          return null;
        }
        const radius = scene.getBodyRadius(bodyId);
        if (radius === null) {
          return null;
        }
        const world = new THREE.Vector3();
        if (!scene.getBodyWorldPosition(bodyId, world)) {
          return null;
        }
        // Projektion ueber die echte Kamera: uebernimmt FOV, Zoom und den
        // tatsaechlichen Abstand. Das ist der Punkt — die Near-Plane
        // (`DISTANCE_NEAR`) klemmt den Abstand nach unten, eine aus dem Radius
        // hochgerechnete Feldgroesse lag deshalb daneben.
        const camera = scene.getCamera();
        const distance = camera.position.distanceTo(world);
        const halfHeight = Math.tan(((camera.fov / 2) * Math.PI) / 180) * distance;
        const pixels = (radius / halfHeight) * (app.canvas.clientHeight / 2);
        const half = Math.max(8, Math.round(pixels * (1 + marginFraction)));
        return {
          x: Math.round(app.canvas.clientWidth / 2 - half),
          y: Math.round(app.canvas.clientHeight / 2 - half),
          width: half * 2,
          height: half * 2,
        };
      },
      /**
       * Liefert einen vergleichbaren Schnappschuss der Szenenstruktur.
       *
       * Wird vom Determinismus-E2E-Test benutzt: zwei Aufrufe der App
       * muessen denselben String liefern.
       *
       * @param atJulianDate - Optionale Simulationszeit (z. B. J2000), auf
       *   die vor dem Auslesen gesetzt wird. Ohne diesen Wert laeuft die
       *   Zeitraffer-Simulation weiter und zwei Aufrufe liefern nie denselben
       *   String — der Determinismus-Test muss deshalb einen festen Zeitpunkt
       *   vorgeben.
       * @returns Stabiler Schnappschuss (siehe `SceneManager.snapshot`).
       */
      snapshot: (atJulianDate?: number): string =>
        app.scene?.snapshot(atJulianDate) ?? '',
    };
  }

  /**
   * Legt das Canvas als randlose, bildschirmfuellende Ebene hinter der UI ab.
   *
   * Ohne diesen Schritt bleibt ein `<canvas>` bei der HTML-Standardgroesse von
   * 300x150 Pixeln und die Szene ist nur als kleines Rechteck sichtbar. Der
   * Inline-Style ist Absicht: er gehoert zur Verdrahtung in dieser Datei und
   * nicht in das Stylesheet der UI.
   *
   * @returns {void}
   */
  private applyCanvasLayout(): void {
    const style = this.canvas.style;
    style.position = "fixed";
    style.inset = "0";
    style.width = "100%";
    style.height = "100%";
    style.display = "block";
    style.zIndex = "0";

    // Das Canvas liegt jetzt ueber der gesamten Seite. Damit die UI wieder
    // klickbar wird, muss ihr Container ebenfalls gestapelt werden — und zwar
    // darueber. Sonst schluckt das Canvas jeden Klick auf Elemente, die nicht
    // selbst positioniert sind.
    const rootStyle = this.root.style;
    rootStyle.position = "relative";
    rootStyle.zIndex = "1";
  }

  /**
   * Erzeugt den `SceneManager` und haengt das Schiff-Objekt in die Szene.
   *
   * @returns {void}
   */
  private buildScene(): void {
    const scene = new SceneManager(this.canvas, {
      scaleMode: this.scaleMode,
      distanceMode: this.distanceMode,
      bloomMode: this.bloomMode,
      textures: this.texturesEnabled,
    });
    scene.init();
    scene.setTime(this.julianDate);
    this.scene = scene;

    const ship = new Ship(this.scaleMode, this.distanceMode);
    // Startposition vor der Sonne, nicht in ihrem Kern.
    const sunRadius = scaleRadius(SUN_RADIUS_KM, this.scaleMode);
    ship.setPosition({ x: 0, y: 0, z: sunRadius * SHIP_START_FACTOR });
    this.ship = ship;
    scene.getScene().add(ship.getObject());
  }

  /**
   * Verbindet Schiff, Steuerung und Kamera und laedt Modell + Sounds.
   *
   * @returns {void}
   */
  private async buildShip(): Promise<void> {
    const scene = this.scene;
    const ship = this.ship;
    if (scene === null || ship === null) {
      return;
    }

    // Modell laden (Platzhalter bleibt sichtbar, bis das GLB da ist).
    try {
      await ship.loadModel();
      await ship.loadSounds();
    } catch {
      // Platzhalter + fallback ohne Audio — App startet trotzdem.
    }

    this.camera = new CameraFollow(scene.getCamera());
    this.camera.setTarget(ship.getObject());
    this.camera.setMode("follow");

    this.controls = new ShipControls(ship, this.camera);
    this.controls.attach(this.canvas);
    this.controls.setQuickTravelPositions(this.readBodyPositions(scene));
    this.focusCanvasOnSceneClick();
  }

  /**
   * Setzt den Tastaturfokus auf das Canvas, sobald in die Szene geklickt wird.
   *
   * `ShipControls` hoert am Canvas; ohne Fokus laeuft die Tastatursteuerung
   * also nur, solange das Canvas aktiv ist. Der Klick in die Szene soll sie
   * deshalb wieder scharf schalten. Der Handler bleibt ueber `dispose`
   * abgeloest, weil das Canvas dann ohnehin entfernt wird.
   *
   * @returns {void}
   */
  private focusCanvasOnSceneClick(): void {
    this.canvas.addEventListener("pointerdown", () => {
      this.canvas.focus({ preventScroll: true });
    });
  }

  /**
   * Liest die Weltpositionen aller Koerper-Meshes aus der Szene.
   *
   * `SceneManager` bietet bewusst keinen Zugriff auf die Meshes; die
   * BodyFactory benennt sie aber nach der Koerper-ID, daher laesst sich die
   * Zuordnung rein lesend ueber den Szenengraphen gewinnen.
   *
   * @param scene - Die initialisierte Szene.
   * @returns Zuordnung Koerper-ID -> Weltposition.
   */
  private readBodyPositions(scene: SceneManager): Map<string, THREE.Vector3> {
    const positions = new Map<string, THREE.Vector3>();
    const world = new THREE.Vector3();
    scene.getScene().updateMatrixWorld(true);
    scene.getScene().traverse((object) => {
      if (object.name === "" || object.name.endsWith("-glow")) {
        return;
      }
      if (positions.has(object.name)) {
        return;
      }
      object.getWorldPosition(world);
      positions.set(object.name, world);
    });
    // Die instanzierten Monde (449 der 456) haben kein eigenes Mesh und
    // tauchen im Szenengraphen deshalb nicht auf. Ohne sie fehlt in der
    // Map jede Position, und `focusBody` bricht mit einem stillen `return`
    // ab: der Nav-Knopf schlieelicht, aber es passiert sichtbar nichts.
    for (const id of scene.getBodyIds()) {
      if (positions.has(id)) {
        continue;
      }
      if (scene.getBodyWorldPosition(id, world)) {
        positions.set(id, world);
      }
    }
    return positions;
  }

  /**
   * Erzeugt und mountet HUD, Navigation, Datenpanel und Quiz.
   *
   * @param bodies - Geladene Koerperliste fuer die Navigation.
   * @param dataBaseUrl - Basis-URL, unter der die Datendateien liegen.
   * @returns {void}
   */
  private buildUi(bodies: readonly BodyData[], dataBaseUrl: string): void {
    const playClick = (): void => {
      this.ship?.playClickSound();
    };

    this.hud = new HudUI(this.root, {
      initialSizeMode: toHudSizeMode(this.scaleMode),
      initialDistanceMode: toHudDistanceMode(this.distanceMode),
      onScaleModeChange: (kind, mode) => {
        playClick();
        if (kind === "size") {
          this.setScaleMode(mode === "real" ? "real" : "visual");
        } else {
          this.setDistanceMode(mode === "real" ? "real" : "visual");
        }
      },
      onPauseToggle: (paused) => {
        playClick();
        this.paused = paused;
      },
      onDetailModeChange: (mode) => {
        playClick();
        this.scene?.setKnownOnly(mode === 'known');
      },
    });
    this.hud.mount();

    this.panel = new InfoPanelUI(this.root, { dataBaseUrl });
    this.panel.mount();

    this.nav = new NavUI(this.root, {
      onSelect: (id) => {
        playClick();
        this.focusBody(id);
      },
    });
    this.nav.mount();
    this.nav.update(bodies);

    this.quiz = new QuizUI(this.root, { dataBaseUrl });
    this.quiz.mount();
    this.quizButton = this.createQuizButton();
  }

  /**
   * Erzeugt den Startknopf fuer das Quiz.
   *
   * `QuizUI` liefert nur den Inhalt, keinen Ausloeser. Der Knopf wird hier
   * erzeugt und an denselben Container gehaengt wie die uebrige UI.
   *
   * @returns Der neu erzeugte Knopf.
   */
  private createQuizButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "se-button se-quiz-toggle";
    button.textContent = QUIZ_START_LABEL;
    // `.se-quiz-toggle` ist im Stylesheet nicht definiert. Ohne Positionierung
    // landet der Knopf als statisches Element oben links unter der Navigation;
    // links unten collidiert er mit dem Schiffsfeld des HUD. Mitte unten ist
    // frei und liegt direkt unter dem Quiz-Fenster.
    button.style.position = "fixed";
    button.style.left = "50%";
    button.style.bottom = "16px";
    button.style.transform = "translateX(-50%)";
    button.style.zIndex = "16";
    button.addEventListener("click", () => {
      this.ship?.playClickSound();
      this.toggleQuiz();
    });
    this.root.appendChild(button);
    return button;
  }

  /**
   * Startet das Lernquiz oder beendet es, wenn es schon laeuft.
   *
   * `QuizUI` bringt keinen sichtbaren Startknopf mit; die Verdrahtung hier
   * stellt deshalb einen eigenen bereit (zusaetzlich Taste Q). Die Fragen
   * werden erst beim ersten Start geladen, damit der App-Start nicht durch
   * einen zweiten Datenzugriff belegt wird.
   *
   * @returns {void}
   */
  private toggleQuiz(): void {
    const quiz = this.quiz;
    const button = this.quizButton;
    if (quiz === null) {
      return;
    }
    if (this.quizActive) {
      quiz.stop();
      this.quizActive = false;
      if (button !== null) {
        button.textContent = QUIZ_START_LABEL;
      }
      return;
    }
    this.quizActive = true;
    if (button !== null) {
      button.textContent = QUIZ_STOP_LABEL;
    }
    void quiz.start().catch(() => {
      // `QuizUI` zeigt im Fehlerfall selbst eine freundliche Meldung.
      this.quizActive = false;
      if (button !== null) {
        button.textContent = QUIZ_START_LABEL;
      }
    });
  }

  /**
   * Startet die Bildschleife.
   *
   * @returns {void}
   */
  startLoop(): void {
    if (this.frameHandle !== null) {
      return;
    }
    this.lastFrameMs = performance.now();
    const loop = (now: number): void => {
      const rawDelta = (now - this.lastFrameMs) / 1000;
      this.lastFrameMs = now;
      const delta = Math.min(
        Math.max(Number.isFinite(rawDelta) ? rawDelta : 0, 0),
        MAX_FRAME_DELTA_SECONDS,
      );
      if (delta > 0) {
        this.fps = this.fps === 0 ? 1 / delta : this.fps * 0.9 + (1 / delta) * 0.1;
      }
      this.tick(delta);
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  /**
   * Ein Bild der Simulation: Zeit, Schiff, Steuerung, Kamera, HUD, Render.
   *
   * @param deltaSeconds - Vergangene Zeit in Sekunden (0..0.1).
   * @returns {void}
   */
  private tick(deltaSeconds: number): void {
    const scene = this.scene;
    const ship = this.ship;
    if (scene === null || ship === null) {
      return;
    }

    if (!this.paused) {
      this.julianDate += (deltaSeconds * this.timeScale) / SECONDS_PER_DAY;
    }
    scene.setTime(this.julianDate);

    // Merken, ob vorher eine Auto-Travel-Reise lief.
    const wasTraveling = this.controls?.isAutoTravelActive() ?? false;

    this.controls?.update(deltaSeconds);
    ship.updateMovement(deltaSeconds);
    this.refreshQuickTravelPositions();

    this.camera?.update(deltaSeconds);

    // Ankunft: Auto-Travel abgeschlossen → Skalierung auf real
    // umschalten (Wow-Effekt bei der Ankunft).
    if (wasTraveling && !(this.controls?.isAutoTravelActive() ?? false)) {
      if (this.scaleMode !== "real" && this.activeBodyId !== null) {
        this.setScaleMode("real");
        // Positionsdaten neu lesen (veraendern sich beim Moduswechsel).
        this.quickTravelPositions = this.readBodyPositions(scene);
        const newPos = this.quickTravelPositions.get(this.activeBodyId);
        if (newPos !== undefined) {
          const radius = scene.getBodyRadius(this.activeBodyId) ?? 1;
          const offset = Math.max(radius * FOCUS_APPROACH_FACTOR, 1);
          ship.setPosition({
            x: newPos.x,
            y: newPos.y,
            z: newPos.z + offset,
          });
        }
      }
    }

    scene.render();
    this.updateHud();
  }

  /**
   * Aktualisiert die Schnellreise-Ziele auf die aktuellen Koerperpositionen.
   *
   * Die Planeten bewegen sich im Laufe der Simulation; ohne dieses
   * Nachfuehren wuerde `M`/`F` immer zum Startort fliegen.
   *
   * @returns {void}
   */
  private refreshQuickTravelPositions(): void {
    const scene = this.scene;
    const controls = this.controls;
    if (scene === null || controls === null) {
      return;
    }
    if ((scene.getJulianDate() - this.lastQuickTravelDate) * SECONDS_PER_DAY < 1) {
      return;
    }
    this.lastQuickTravelDate = scene.getJulianDate();
    this.quickTravelPositions = this.readBodyPositions(scene);
    const plain = new Map<string, { x: number; y: number; z: number }>();
    for (const [id, position] of this.quickTravelPositions) {
      plain.set(id, { x: position.x, y: position.y, z: position.z });
    }
    controls.setQuickTravelPositions(plain);
  }

  /**
   * Schreibt den aktuellen Zustand ins HUD.
   *
   * @returns {void}
   */
  private updateHud(): void {
    const hud = this.hud;
    const scene = this.scene;
    const ship = this.ship;
    if (hud === null || scene === null || ship === null) {
      return;
    }
    const status: ShipStatus = {
      speedKmS: ship.getSpeedKmS(),
      headingDeg: ship.getHeadingDeg(),
      thrustLevel: ship.getThrustLevel(),
    };
    hud.update({
      julianDate: this.julianDate,
      timeScale: this.timeScale,
      sizeMode: toHudSizeMode(this.scaleMode),
      distanceMode: toHudDistanceMode(this.distanceMode),
      ship: status,
      fps: this.fps,
      paused: this.paused,
    });
  }

  /**
   * Waehlt einen Koerper aus: Schiff fliegt glatt dorthin.
   *
   * Statt die Kamera direkt zu setzen oder das Schiff zu teleportieren,
   * wird eine gleichmaessige Interpolation gestartet. Die Kamera
   * folgt dem Schiff automatisch (CameraFollow).
   *
   * @param id - Koerper-ID aus `bodies.json`, z. B. `"mars"`.
   * @returns {void}
   */
  focusBody(id: string): void {
    const scene = this.scene;
    const ship = this.ship;
    const controls = this.controls;
    if (scene === null || ship === null || controls === null) {
      return;
    }
    const position = this.quickTravelPositions.get(id);
    if (position === undefined) {
      return;
    }
    const radius = scene.getBodyRadius(id) ?? 1;
    const offset = Math.max(radius * FOCUS_APPROACH_FACTOR, 1);
    const target = {
      x: position.x,
      y: position.y,
      z: position.z + offset,
    };

    // Ggf. laufende Reise abbrechen und neuen Flug starten.
    controls.cancelAutoTravel();
    controls.startAutoTravel(target);

    this.activeBodyId = id;
    this.nav?.setActive(id);
    this.panel?.showBody(id);
    this.camera?.setMode("follow");
  }

  /**
   * Haelt die Simulation an oder laesst sie weiterlaufen.
   *
   * @returns {void}
   */
  togglePause(): void {
    this.paused = !this.paused;
    this.updateHud();
  }

  /**
   * Wechselt die Radius-Skalierung der Szene.
   *
   * @param mode - Neuer Skalierungsmodus.
   * @returns {void}
   */
  setScaleMode(mode: ScaleMode): void {
    this.scaleMode = mode;
    this.scene?.setScaleMode(mode);
    this.hud?.setSizeMode(toHudSizeMode(mode));
    this.updateHud();
  }

  /**
   * Wechselt die Distanz-Skalierung der Szene.
   *
   * @param mode - Neuer Distanzmodus.
   * @returns {void}
   */
  setDistanceMode(mode: DistanceMode): void {
    this.distanceMode = mode;
    this.scene?.setDistanceMode(mode);
    this.hud?.setDistanceMode(toHudDistanceMode(mode));
    this.refreshQuickTravelPositions();
  }

  /**
   * Liefert die ID des aktuell gewaehlten Koerpers.
   *
   * @returns Koerper-ID oder `null`, wenn noch keiner gewaehlt wurde.
   */
  getActiveBodyId(): string | null {
    return this.activeBodyId;
  }

  /**
   * Wechselt den Zeitraffer.
   *
   * @param preset - Neuer Zeitraffer aus `core/scale`.
   * @returns {void}
   */
  setTimeScale(preset: TimePreset): void {
    this.timeScale = timeScaleFor(preset);
    this.updateHud();
  }

  /**
   * Loest Szene, Schiff, Steuerung, Kamera und alle UI-Komponenten auf.
   *
   * Nach dem Aufruf ist die App unbrauchbar; `dispose` ist idempotent.
   *
   * @returns {void}
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    window.removeEventListener("resize", this.onWindowResize);
    window.removeEventListener("keydown", this.onWindowKeyDown);

    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }

    this.controls?.detach();
    this.controls = null;
    this.camera?.dispose();
    this.camera = null;
    this.ship?.dispose();
    this.ship = null;
    this.scene?.dispose();
    this.scene = null;

    this.hud?.dispose();
    this.hud = null;
    this.nav?.dispose();
    this.nav = null;
    this.panel?.dispose();
    this.panel = null;
    this.quiz?.dispose();
    this.quiz = null;
    this.quizButton?.remove();
    this.quizButton = null;
    this.quizActive = false;

    this.quickTravelPositions.clear();
    this.activeBodyId = null;
  }
}
