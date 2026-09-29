import { describe, it, expect } from "vitest";

import { scaleDistance } from "../../src/core/scale";
import { AU_KM } from "../../src/core/constants";

/**
 * Sichtbarkeitstest der Startkamera.
 *
 * Regressionstest: Bei der Umstellung der Distanzskalierung (Potenzkurve
 * -> Kniepunkt-Kurve) lag Neptun plötzlich bei ~434 Szeneneinheiten statt
 * bei 16. Die Kamera stand weiterhin auf ihrem alten Stand und schaute
 * dadurch an Uranus und Neptun vorbei. Dieser Test hält fest, dass alle
 * acht Umlaufbahnen im Bild liegen.
 *
 * Er rechnet die perspektivische Projektion von Hand nach, statt zu
 * raten: Kamera, Bildformat und Oeffnungswinkel sind exakt die Werte aus
 * `SceneManager` bzw. `playwright.config.ts`.
 */

const CAMERA = { y: 150, z: 850 } as const;
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

/** Maximale Bahnkoepertie ueber alle Planeten, in Szeneneinheiten. */
function maxOrbitRadius(): number {
  let max = 0;
  for (const [, au] of PLANET_AU) {
    max = Math.max(max, scaleDistance(au * AU_KM, "visual"));
  }
  return max;
}

/**
 * Projiziert einen Punkt auf normalized device coordinates.
 *
 * @param p Weltposition des Punktes.
 * @returns x und y zwischen -1 und 1, sofern der Punkt vor der Kamera liegt.
 */
function toNdc(p: readonly [number, number, number]): {
  x: number;
  y: number;
} {
  const d = Math.hypot(CAMERA.y, CAMERA.z);
  const fwd: readonly [number, number, number] = [0, -CAMERA.y / d, -CAMERA.z / d];
  const up: readonly [number, number, number] = [0, CAMERA.z / d, -CAMERA.y / d];
  const right: readonly [number, number, number] = [1, 0, 0];
  const v: readonly [number, number, number] = [p[0], p[1] - CAMERA.y, p[2] - CAMERA.z];

  const zc = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
  const xc = v[0] * right[0] + v[1] * right[1] + v[2] * right[2];
  const yc = v[0] * up[0] + v[1] * up[1] + v[2] * up[2];

  const tanY = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
  const tanX = tanY * (WIDTH / HEIGHT);
  return { x: xc / (zc * tanX), y: yc / (zc * tanY) };
}

/** Liefert den groessten absoluten NDC-Wert ueber einen ganzen Bahnkreis. */
function worstNdcOnOrbit(radius: number): number {
  let worst = 0;
  for (let deg = 0; deg < 360; deg += 10) {
    const a = (deg * Math.PI) / 180;
    for (const height of [-60, 0, 60]) {
      const ndc = toNdc([radius * Math.cos(a), height, radius * Math.sin(a)]);
      worst = Math.max(worst, Math.abs(ndc.x), Math.abs(ndc.y));
    }
  }
  return worst;
}

describe("Startkamera zeigt das ganze Sonnensystem", () => {
  it("legt die Bahnradien der acht Planeten in Szeneneinheiten fest", () => {
    const radii = PLANET_AU.map(([id, au]) => [
      id,
      scaleDistance(au * AU_KM, "visual"),
    ]);
    for (const [id, r] of radii) {
      expect(Number.isFinite(r as number), `${id} hat einen endlichen Radius`).toBe(true);
      expect(r as number).toBeGreaterThan(0);
    }
    // Neptun muss der aeusserste Planet sein.
    const neptun = radii.find(([id]) => id === "neptun")?.[1] as number;
    expect(neptun).toBeGreaterThan(400);
    expect(neptun).toBeLessThan(500);
  });

  it.each(PLANET_AU)(
    "die Bahn von %s liegt vollstaendig im Bild",
    (_id, au) => {
      const radius = scaleDistance(au * AU_KM, "visual");
      expect(worstNdcOnOrbit(radius)).toBeLessThanOrEqual(1);
    },
  );

  it("sorgt dafuer, dass auch der aeusserste Planet Luft nach aussen hat", () => {
    // Nicht nur sichtbar, sondern mit Reserve: sonst schneidet ein minimal
    // groesserer Radius (z. B. die Monde Neptuns) sofort wieder ab.
    expect(worstNdcOnOrbit(maxOrbitRadius())).toBeLessThan(0.9);
  });
});
