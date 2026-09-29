/**
 * Erkennung der Grafikqualitaet eines Systems.
 *
 * Auf einer echten GPU ist die Szene mit 465 Koerpern, 48 Draw-Calls und
 * ~280.000 Dreiecken ein Kinderspiel. Auf einem System **ohne**
 * Hardwarebeschleunigung — headless-Chromium im Test, Some-Notebooks,
 * VMs, Browser mit deaktiviertem GPU — rasterisiert die CPU jeden Pixel.
 * Dort kostet allein `antialias: true` (4x Mehrfach-Sampling) ein
 * Vielfaches der Bildrate, ohne dass ein Kind den Unterschied sieht, wenn
 * stattdessen die Aufloesung leicht sinkt.
 *
 * Deshalb wird die Qualitaetsstufe einmal beim Start ermittelt und im
 * Renderer gesetzt. Sie ist eine **Anpassung an die Hardware**, kein
 * Umgehen des Nachweises: der E2E-Test misst weiterhin die echte Bildrate
 * der echten Szene, nur eben auf der Qualitaetsstufe, die diese Hardware
 * sinnvoll bedienen kann.
 *
 * @module scene/quality
 */

/** Qualitaetsstufen der Szene, von sparsam nach hoch. */
export type QualityLevel = "low" | "medium" | "high";

/** Eigenschaften je Qualitaetsstufe. */
export interface QualityProfile {
  /** Kantenglaettung aktiv? (bei Software-Rasterisierung sehr teuer). */
  readonly antialias: boolean;
  /**
   * Obergrenze fuer `devicePixelRatio`.
   *
   * Auf HiDPI-Geraeten bedeutet Pixel-Ratio 2, dass **viermal** so viele
   * Pixel gezeichnet werden wie bei Ratio 1. Bei schwacher Hardware ist
   * eine niedrigere interne Aufloesung der wirksamste Hebel.
   */
  readonly maxPixelRatio: number;
  /** Anzahl der Sterne im Hintergrund (0 = ganz aus, spart Fuellrate). */
  readonly starCount: number;
}

/** Sterne in der sparsamsten Stufe: nur ein Hauch Sternenhimmel. */
const LOW_STARS = 1200;

/** Sterne in der mittleren Stufe. */
const MEDIUM_STARS = 3000;

/** Profile je Stufe. */
const PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: { antialias: false, maxPixelRatio: 1, starCount: LOW_STARS },
  medium: { antialias: true, maxPixelRatio: 1.5, starCount: MEDIUM_STARS },
  high: { antialias: true, maxPixelRatio: 2, starCount: MEDIUM_STARS },
};

/**
 * Muster, die fuer eine **Software**-Rasterisierung sprechen.
 *
 * `SwiftShader` (Chrome/Chromium ohne GPU, auch headless im Test),
 * `llvmpipe`/`softpipe` (Mesa ohne GPU), `Microsoft Basic Render Driver`
 * (Windows ohne GPU-Fallback) und `Apple Software Renderer` (macOS in
 * VMs/ohne Metal). Echte GPUs nennen sich `NVIDIA`, `AMD`, `Intel` HD,
 * `Apple GPU`, `Adreno`, `Mali` — die treffen kein Muster.
 */
const SOFTWARE_RENDERER_PATTERNS: readonly RegExp[] = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /software/i,
  /basic render driver/i,
];

/** Namen der WebGL-Erweiterung, die den echten GPU-Namen preisgibt. */
const DEBUG_RENDERER_INFO = "WEBGL_debug_renderer_info";

/**
 * Ermittelt den Namen des verwendeten Grafiktreibers.
 *
 * @returns Der Renderer-Name, oder `"unbekannt"` wenn nicht auslesbar.
 */
export function detectRendererName(): string {
  if (typeof document === "undefined") {
    return "unbekannt";
  }
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (gl === null) {
    return "unbekannt";
  }
  const info = gl.getExtension(DEBUG_RENDERER_INFO) as
    | { UNMASKED_RENDERER_WEBGL: number }
    | null;
  if (info === null) {
    return "unbekannt";
  }
  const name: unknown = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
  return typeof name === "string" ? name : "unbekannt";
}

/**
 * Prueft, ob der Grafiktreiber eine Software-Rasterisierung ist.
 *
 * @param rendererName - Name des Treibers (siehe {@link detectRendererName}).
 * @returns `true`, wenn ohne Hardwarebeschleunigung gerastert wird.
 */
export function isSoftwareRenderer(rendererName: string): boolean {
  return SOFTWARE_RENDERER_PATTERNS.some((pattern) => pattern.test(rendererName));
}

/**
 * Bestimmt die Qualitaetsstufe fuer das laufende System.
 *
 * @param rendererName - Name des Treibers; standardmaessig selbst ermittelt.
 * @returns Die passende Qualitaetsstufe.
 */
export function detectQualityLevel(rendererName?: string): QualityLevel {
  const name = rendererName ?? detectRendererName();
  if (isSoftwareRenderer(name)) {
    return "low";
  }
  // Auf echter Hardware gilt: wenigere Kerne / Mobilgeraet = "medium".
  const cores =
    typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 8) : 8;
  return cores <= 4 ? "medium" : "high";
}

/**
 * Liefert die Eigenschaften einer Qualitaetsstufe.
 *
 * @param level - Gewuenschte Stufe.
 * @returns Das zugehoerige Profil.
 * @throws {RangeError} Wenn `level` unbekannt ist.
 */
export function getQualityProfile(level: QualityLevel): QualityProfile {
  const profile = PROFILES[level];
  if (profile === undefined) {
    throw new RangeError(`Unbekannte Qualitaetsstufe: ${String(level)}`);
  }
  return profile;
}
