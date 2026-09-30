/**
 * Sonnenglanz: HDR-Sonne plus `UnrealBloomPass`.
 *
 * ## Warum beides noetig ist
 *
 * `UnrealBloomPass` ist im Kern ein Helligkeits-Hochpass
 * (`LuminosityHighPassShader`): es blutet nur, was **heller als `threshold`**
 * ist, und der Uebergang ist mit `smoothWidth = 0.01` praktisch binaer
 * (gemessen in `tools/bloom_luminance.mjs`).
 *
 * Die Sonne hat im Klartext-Farbraum L = 0.523 — **unter jeder brauchbaren
 * Schwelle**. Eine gesenkte Schwelle allein bewirkt also gar nichts; wird sie
 * tief genug gesenkt (0.30), blueten Uranus und Saturn mit (L ~ 0.32). Deshalb
 * wird die Sonnenfarbe zusaetzlich auf HDR gehoben ({@link SUN_HDR_GAIN},
 * L = 1.308) und die Schwelle ueber die hellste Planetenluminanz gehalten:
 * Planeten bluten nicht, die Sonne schon.
 *
 * ## Warum nur ab Qualitaetsstufe `medium`
 *
 * Der Bloom kostet 11 zusaetzliche Vollbild-Durchgaenge (5 Mip-Stufen,
 * horizontal + vertikal, Composite, Blend). Auf einem Software-Rasterisierer
 * (headless-Chromium, VM) ist genau die Fuellrate der Engpass — dort wuerde
 * der Effekt die Bildrate in dienaehe Null druecken. `?bloom=on` erzwingt ihn
 * trotzdem, damit der Effekt auch ohne GPU nachweisbar ist.
 *
 * @module scene/SunGlow
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { QualityLevel } from "./quality";
import type { BloomMode } from "./types";

/**
 * Faktor, mit dem die Farbe des Sonnenkorpus multipliziert wird.
 *
 * Naeherungsweise farbraum-treu (gleiche Verhaeltnisse der Kanaele), nur
 * heller. Ergebnis: lineare Luminanz L = 0.523 * 2.5 = 1.308, also klar
 * ueber der Bloom-Schwelle von 1.0. Ohne Tone-Mapping ist das zulaessig: das
 * Material wird in ein HalfFloat-Rendertarget des Composers gezeichnet, und
 * three wendet Tone-Mapping nur beim Zeichnen **auf den Bildschirm** an.
 */
export const SUN_HDR_GAIN = 2.5;

/**
 * Staerke des Glanzes (Multiplikator des hochgepassten Bildes).
 *
 * Bewusst **niedrig**. Der Three-Beispielwert von 1.2-2.0 ist fuer kleine
 * gluehende Punkte in dunklen Szenen gedacht; hier sitzt ein ausgedehntes
 * HDR-Objekt (L = 1.308) in der Bildmitte. Gemessen am Bildfeld um die Sonne
 * (`tools/glow_measure.mjs`, 320x320 Pixel, Kern = L >= 150, Einzelbild):
 *
 * | Staerke / Radius | Kernpixel | Faktor |
 * |---|---|---|
 * | 0.35 / 0.2 (gewählt) | ~3 500 | 2.3x |
 * | 1.2 / 0.2 | ~20 700 | 13.5x |
 * | 1.2 / 0.5 (Three-Defaults) | ~23 900 | 16.0x |
 *
 * Beide Achsen vergroessern den Hof, aber die **Staerke** dominiert: der
 * Radius allein (0.35/0.2 -> 1.2/0.2) macht schon den Siebenfachen. Bei
 * 1.2/0.5 liegt die orange Scheibe als diffuse Wolke ueber Guertel und den
 * beiden sichtbaren inneren Planeten.
 *
 * Warum klein: der Hof soll die Sonne umschliessen, nicht den Guertel und
 * die inneren Planeten zusaetzen. Wer den Effekt groesser will, dreht
 * `BLOOM_STRENGTH` hoch.
 *
 * Zur Nachweiszahl: die mittlere Helligkeit des Feldes steigt mit dieser
 * Einstellung um den Faktor 1.95 (gemessen 47.9 -> 93.4, `bloom=off` gegen
 * `bloom=on` auf derselben Seiteninstanz bei angehaltener Zeit). Die
 * Kernflaeche haengt dagegen an der Restwanderung der Kamera und ist als
 * Nachweis zu schwach.
 */
export const BLOOM_STRENGTH = 0.35;

/**
 * Weichzeichner-Radius ueber die fuenf Bloom-Stufen.
 *
 * 0.2 statt 0.5: der Radius addiert die **weitesten** Mip-Stufen, deren
 * Beitrag als grosse, weiche Scheibe ueber Guertel und innere Planeten liegt.
 * Gemessen wirkt der Hof bei 0.2 runder um den Kern, bei 0.5 zerfasert er in
 * eine breite, flache Wolke (Sichtpruefung `docs/glow-on.png`).
 */
export const BLOOM_RADIUS = 0.2;

/**
 * Helligkeitsschwelle des Hochpasses.
 *
 * 1.0 liegt ueber dem hellsten Nicht-Sonnen-Bildpunkt: die hellste
 * Planetenfarbe (Uranus, Albedo-L = 0.633) erreicht selbst mit dem
 * Hemisphaerenlicht 1.6 nur L ~ 0.32 (Lambert: 0.633 * 1.6 / PI), die
 * hellsten Sterne 0.95, das Triebwerksgluehen 0.53. Planeten und Sterne
 * bleiben damit unangetastet; die Sonne ist der einzige Bluetzer.
 */
export const BLOOM_THRESHOLD = 1.0;

/** Name des Nutzdaten-Keys, der eine bereits gehobene Sonne markiert. */
const HDR_KEY = "sunHdrGain";

/** Eingestellte Parameter des Sonnenglanzes. */
export interface SunGlowSettings {
  /** `true`, wenn ein Postprocessing-Composer benutzt wird. */
  readonly enabled: boolean;
  /** Multiplikator des hochgepassten Bildes. */
  readonly strength: number;
  /** Radius des Weichzeichners. */
  readonly radius: number;
  /** Helligkeitsschwelle des Hochpasses. */
  readonly threshold: number;
}

/**
 * Reziproke Luminanz (Rec.709) eines linearen three-Farbs.
 *
 * Dieselbe Formel, die `LuminosityHighPassShader` im Shader benutzt — ohne
 * sie waere jede Aussage ueber die Bloom-Schwelle geraten.
 *
 * @param color - Farbe im linearen Arbeitsraum.
 * @returns Luminanz (0..1 bei SDR-Farben, groesser bei HDR).
 */
export function relativeLuminance(color: THREE.Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Entscheidet, ob der Sonnenglanz laeuft, und mit welchen Parametern.
 *
 * @param level - Erkannte Qualitaetsstufe (siehe `scene/quality`).
 * @param mode - `auto` folgt der Qualitaetsstufe, `on`/`off` erzwingen.
 * @returns Die Parameter; `enabled` ist auf der sparsamen Stufe `false`,
 *   ausser der Modus erzwingt ihn.
 */
export function resolveSunGlowSettings(
  level: QualityLevel,
  mode: BloomMode = "auto",
): SunGlowSettings {
  const enabled = mode === "on" || (mode === "auto" && level !== "low");
  return {
    enabled,
    strength: BLOOM_STRENGTH,
    radius: BLOOM_RADIUS,
    threshold: BLOOM_THRESHOLD,
  };
}

/**
 * Hebt die Farbe des Sonnenkorpus auf HDR-Niveau.
 *
 * Wirkt nur auf `MeshBasicMaterial` (die Sonne ist unbeleuchtet) und hoeht
 * **einmal** — ein zweiter Aufruf multipliziert nicht erneut, weil der
 * Zustand am Mesh klebt. Dadurch bleibt ein Neuaufbau der Szene
 * (Skalierungswechsel) idempotent.
 *
 * @param mesh - Mesh des Sterns (Sonne).
 * @returns {void}
 */
export function boostSunSurface(mesh: THREE.Mesh): void {
  if (mesh.userData[HDR_KEY] !== undefined) {
    return;
  }
  mesh.userData[HDR_KEY] = SUN_HDR_GAIN;
  const material = mesh.material;
  if (material instanceof THREE.MeshBasicMaterial) {
    material.color.multiplyScalar(SUN_HDR_GAIN);
  }
}

/**
 * Zeichenaufrufe und Dreiecke, so wie sie der Szenendurchgang erzeugt hat.
 */
export interface SceneRenderStats {
  /** Zeichenaufrufe der Szene (ohne die Vollbild-Quadse der Passes). */
  readonly drawCalls: number;
  /** Gezeichnete Dreiecke der Szene. */
  readonly triangles: number;
}

/**
 * Pass, der die Szenen-Statistik faengt, bevor die Bloom-Quadse den Zaehler
 * ueberschreiben.
 *
 * `WebGLRenderer` ruft `info.reset()` am **Anfang** jedes `render()` auf — und
 * jeder Composer-Pass ist ein eigener `render()`-Aufruf mit einem
 * Vollbild-Quad. Ohne diesen Pass meldet `renderer.info.render.calls` also die
 * Zeichenaufrufe des *letzten* Passes (1 bzw. 2), nicht die der Szene.
 *
 * Die Alternative waere `renderer.info.autoReset = false` mit eigenem
 * `reset()` pro Bild (three dokumentiert das als Muster). Die laesst aber
 * `info.render.calls` zur Summe aus Szene **und** Passes werden, waehrend die
 * Draw-Call-Grenzen im Projekt die Szene beschreiben — deshalb der
 * Schnappschuss direkt nach `RenderPass`.
 *
 * @module scene/SunGlow
 */
class SceneStatsPass extends Pass {
  /** Zeichenaufrufe des zuletzt gezeichneten Szenendurchgangs. */
  drawCalls = 0;

  /** Dreiecke des zuletzt gezeichneten Szenendurchgangs. */
  triangles = 0;

  constructor() {
    super();
    // Der Pass zeichnet nichts und darf die Puffer deshalb nicht tauschen —
    // `UnrealBloomPass` erwartet das Ergebnis des `RenderPass` im Lesepuffer.
    this.needsSwap = false;
  }

  /**
   * Merkt sich die Zaehler des Szenendurchgangs, ohne zu zeichnen.
   *
   * @param renderer - Der Renderer, dessen `info` gelesen wird.
   * @returns {void}
   */
  override render(renderer: THREE.WebGLRenderer): void {
    this.drawCalls = renderer.info.render.calls;
    this.triangles = renderer.info.render.triangles;
  }
}

/**
 * Der Postprocessing-Pfad der Szene: Render -> Stats -> Bloom -> Output.
 *
 * Die Reihenfolge ist bindend: `OutputPass` holt sich Tone-Mapping und
 * Farbraum beim Renderer, muss also als **letzter** Pass laufen. Ohne ihn
 * waere das Bild doppelt tonemapped bzw. linear angezeigt. Der
 * {@link SceneStatsPass} steht direkt nach dem `RenderPass`, weil nur dort
 * die Zaehler noch die der Szene sind.
 */
export class SunGlow {
  /** Die Pass-Kette. */
  private readonly composer: EffectComposer;

  /** Der Bloom-Durchgang. */
  private readonly bloomPass: UnrealBloomPass;

  /** Faengt die Draw-Calls der Szene ab. */
  private readonly statsPass: SceneStatsPass;

  /** Die wirksamen Parameter. */
  private readonly settings: SunGlowSettings;

  /**
   * Baut die Pass-Kette auf.
   *
   * @param renderer - Der WebGL-Renderer der Szene.
   * @param scene - Die zu zeichnende Szene.
   * @param camera - Die Kamera.
   * @param settings - Parameter aus {@link resolveSunGlowSettings}; muss
   *   `enabled` sein, sonst wird kein Composer angelegt.
   * @throws {TypeError} Wenn `settings.enabled` nicht gesetzt ist.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: SunGlowSettings,
  ) {
    if (!settings.enabled) {
      throw new TypeError(
        "SunGlow wird nur fuer enabled=true gebaut — siehe resolveSunGlowSettings().",
      );
    }
    this.settings = settings;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // Muss sofort nach dem `RenderPass` stehen: ab da zaehlen die Bloom-Quadse.
    this.statsPass = new SceneStatsPass();
    this.composer.addPass(this.statsPass);

    const size = renderer.getSize(new THREE.Vector2());
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      settings.strength,
      settings.radius,
      settings.threshold,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  /**
   * Zeichnet ein Bild durch die Pass-Kette.
   *
   * @returns {void}
   */
  render(): void {
    this.composer.render();
  }

  /**
   * Passt Renderziele und Bloom-Aufloesung an die Fenstergroesse an.
   *
   * Muss nach jedem `setPixelRatio` des Renderers aufgerufen werden — sonst
   * rechnet der Bloom mit der internen Aufloesung des Frames davor.
   *
   * @param width - Breite in CSS-Pixeln.
   * @param height - Hoehe in CSS-Pixeln.
   * @returns {void}
   */
  setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  /**
   * Liefert die wirksamen Parameter (fuer Tests und Debug-Haken).
   *
   * @returns Unveraenderliche Kopie der Parameter.
   */
  getSettings(): SunGlowSettings {
    return this.settings;
  }

  /**
   * Liefert die Zeichenaufrufe und Dreiecke des **Szenen**durchgangs.
   *
   * Gelesen wird nicht `renderer.info`, sondern der Schnappschuss direkt nach
   * dem `RenderPass` — sonst zaehlte der letzte Composer-Pass (siehe
   * {@link SceneStatsPass}).
   *
   * @returns Draw-Calls und Dreiecke des letzten Bildes.
   */
  getSceneStats(): SceneRenderStats {
    return { drawCalls: this.statsPass.drawCalls, triangles: this.statsPass.triangles };
  }

  /**
   * Gibt alle Renderziele und Shader der Kette frei.
   *
   * @returns {void}
   */
  dispose(): void {
    this.bloomPass.dispose();
    this.composer.dispose();
  }
}
