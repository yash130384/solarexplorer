/**
 * BELEG, kein Test: gibt die dargestellten Umlaufbahn-Distanzen aus.
 *
 * Wird ueber `npx vitest run tests/unit/scale-report.spec.ts` ausgefuehrt
 * (vitest ist der einzige TS-Runner im Projekt). Die Zahlen stehen im
 * Testreport und sind der Nachweis fuer die Verifikation.
 *
 * @module unit/scale-report
 */

import { describe, it } from "vitest";
import bodiesJson from "../../src/data/bodies.json";
import { AU_KM } from "../../src/core/constants";
import { scaleDistance } from "../../src/core/scale";

interface Body {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly semiMajorAxisKm: number;
}

const BODIES = bodiesJson.bodies as readonly Body[];
const PLANETEN = BODIES.filter((b) => b.type === "planet").sort(
  (a, b) => a.semiMajorAxisKm - b.semiMajorAxisKm,
);
const ERDE = BODIES.find((b) => b.id === "erde") as Body;
const ERDE_VIS = scaleDistance(ERDE.semiMajorAxisKm, "visual");

describe("BELEG: dargestellte Distanzen", () => {
  it("Tabelle Planet | echte AE | dargestellte Einheiten | /Erde", () => {
    const zeilen = [
      "Planet     | echte AE | dargestellt |  /Erde |  real /Erde",
    ];
    for (const p of PLANETEN) {
      const au = p.semiMajorAxisKm / AU_KM;
      const vis = scaleDistance(p.semiMajorAxisKm, "visual");
      const real = p.semiMajorAxisKm / ERDE.semiMajorAxisKm;
      zeilen.push(
        `${p.name.padEnd(10)} | ${au.toFixed(3).padStart(9)} | ${vis
          .toFixed(1)
          .padStart(11)} | ${(vis / ERDE_VIS)
          .toFixed(3)
          .padStart(7)} | ${real.toFixed(3).padStart(7)}`,
      );
    }
    zeilen.push("");
    zeilen.push(
      `Erde (Referenz): 1.000 AE -> ${ERDE_VIS.toFixed(1)} Szeneneinheiten`,
    );
    const jup = BODIES.find((b) => b.id === "jupiter") as Body;
    const nep = BODIES.find((b) => b.id === "neptun") as Body;
    zeilen.push(
      `Jupiter/Erde = ${(
        scaleDistance(jup.semiMajorAxisKm, "visual") / ERDE_VIS
      ).toFixed(3)} (alt mit au^0.35: 1,78 — das war der Fehler)`,
    );
    zeilen.push(
      `Neptun liegt bei ${scaleDistance(nep.semiMajorAxisKm, "visual").toFixed(1)} Einheiten (Kamera bei z=1050)`,
    );
    const k1 = scaleDistance(3.99 * AU_KM, "visual");
    const k2 = scaleDistance(4.01 * AU_KM, "visual");
    zeilen.push(
      `Kniepunkt 4 AE: 3,99 AE -> ${k1.toFixed(3)}, 4,01 AE -> ${k2.toFixed(3)}, Sprung ${(
        (Math.abs(k2 - k1) / k1) *
        100
      ).toFixed(4)} %`,
    );
    let mono = true;
    let prev = -Infinity;
    for (let au = 0.39; au <= 30.0001; au += 0.01) {
      const v = scaleDistance(au * AU_KM, "visual");
      if (v <= prev) mono = false;
      prev = v;
    }
    zeilen.push(`monoton 0,39..30 AE: ${mono}`);
    // Vitest gibt console.log im Reporter aus.
    console.log("\n" + zeilen.join("\n") + "\n");
  });
});
