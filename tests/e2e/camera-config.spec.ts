import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scaleDistance } from "../../src/core/scale";
import { AU_KM } from "../../src/core/constants";

/**
 * Bindet die Startkamera an die tatsaechliche Konfiguration im Code.
 *
 * `tests/unit/camera-frustum.test.ts` rechnet die Sichtbarkeit nach, kennt
 * aber eine fest verdrahtete Kameraposition. Dieser Test liest die echte
 * Konstante aus der Quelle. Aendert jemand `INITIAL_CAMERA_POSITION`, ohne
 * den Sichtbarkeitstest nachzufuehren, schlaegt er hier fehl.
 */

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "..", "src", "scene", "SceneManager.ts"),
  "utf8",
);

const FOV_DEG = 50;
const WIDTH = 1280;
const HEIGHT = 720;

/** Bahnradius der acht Planeten in Astronomischen Einheiten. */
const PLANET_AU: ReadonlyArray<readonly [string, number]> = [
  ["merkur", 0.387],
  ["venus", 0.723],
  ["erde", 1.0],
  ["mars", 1.524],
  ["jupiter", 5.204],
  ["saturn", 9.579],
  ["uranus", 19.188],
  ["neptun", 30.069],
];

test.describe("Startkamera aus dem Code", () => {
  test("liest die Kameraposition aus SceneManager", () => {
    const match =
      /INITIAL_CAMERA_POSITION[^=]*=\s*\[\s*[-\d.]+\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/.exec(
        source,
      );
    expect(match, "INITIAL_CAMERA_POSITION nicht gefunden").not.toBeNull();
    const camY = Number(match?.[1]);
    const camZ = Number(match?.[2]);
    expect(Number.isFinite(camY)).toBe(true);
    expect(Number.isFinite(camZ)).toBe(true);
    expect(camZ).toBeGreaterThan(0);

    /** Projiziert einen Weltpunkt auf normalized device coordinates. */
    const toNdc = (
      p: readonly [number, number, number],
    ): { x: number; y: number } => {
      const d = Math.hypot(camY, camZ);
      const fwd: readonly [number, number, number] = [0, -camY / d, -camZ / d];
      const up: readonly [number, number, number] = [0, camZ / d, -camY / d];
      const v: readonly [number, number, number] = [p[0], p[1] - camY, p[2] - camZ];
      const zc = v[1] * fwd[1] + v[2] * fwd[2];
      const yc = v[1] * up[1] + v[2] * up[2];
      const tanY = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
      const tanX = tanY * (WIDTH / HEIGHT);
      return { x: v[0] / (zc * tanX), y: yc / (zc * tanY) };
    };

    let worstOverall = 0;
    for (const [id, au] of PLANET_AU) {
      const radius = scaleDistance(au * AU_KM, "visual");
      for (let deg = 0; deg < 360; deg += 15) {
        const a = (deg * Math.PI) / 180;
        for (const h of [-60, 0, 60]) {
          const ndc = toNdc([radius * Math.cos(a), h, radius * Math.sin(a)]);
          worstOverall = Math.max(worstOverall, Math.abs(ndc.x), Math.abs(ndc.y));
        }
      }
      expect(
        Math.abs(toNdc([radius, 0, 0]).x),
        `${id}: Bahnradius ${radius.toFixed(0)} liegt im Bild`,
      ).toBeLessThanOrEqual(1);
    }

    // Reserve nach aussen: die Bahnkurve selbst muss noch sichtbar bleiben.
    expect(
      worstOverall,
      `groesster NDC-Wert ueber alle Bahnen: ${worstOverall.toFixed(2)}`,
    ).toBeLessThan(0.95);
  });
});
