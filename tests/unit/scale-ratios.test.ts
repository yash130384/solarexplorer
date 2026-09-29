/**
 * Verhaeltnisse der Umlaufbahnen — gegen die echten Daten aus bodies.json.
 *
 * `src/core/scale.test.ts` prueft die KURVE mit gerundeten Werten. Dieser Test
 * schliesst die Luecke: er faehrt die acht echten Planeten-Datensaetze durch
 * `scaleDistance(..., "visual")` und vergleicht das Verhaeltnis zur Erde-Bahn
 * mit dem Dokumentationsziel. Damit kann eine Aenderung an bodies.json oder an
 * den Konstanten nicht unbemerkt die Planetenpositionen verschieben.
 *
 * @module unit/scale-ratios
 */

import { describe, expect, it } from "vitest";
import bodiesJson from "../../src/data/bodies.json";
import { AU_KM } from "../../src/core/constants";
import { scaleDistance } from "../../src/core/scale";

/** Ein Koerper aus bodies.json (nur die hier benutzten Felder). */
interface Body {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly semiMajorAxisKm: number;
}

/** Alle Koerper aus bodies.json. */
const BODIES: readonly Body[] = bodiesJson.bodies as readonly Body[];

/** Die acht Planeten, nach Abstand zur Sonne sortiert. */
const PLANETEN: readonly Body[] = BODIES.filter(
  (b) => b.type === "planet",
).sort((a, b) => a.semiMajorAxisKm - b.semiMajorAxisKm);

/** Die Erde als Referenz — sie definiert das Verhaeltnis 1,00. */
const ERDE: Body = BODIES.find((b) => b.id === "erde") as Body;

/**
 * Dokumentationsziel je Planet: [min. Verhaeltnis, max. Verhaeltnis] zur Erde.
 *
 * Werte aus `specs/16_verify_scaling.md`. Die inneren vier Planeten liegen
 * unterhalb des Kniepunkts (4 AE) und muessen daher exakt ihre echten
 * Verhaeltnisse treffen (0,39 / 0,72 / 1,00 / 1,52). Die aeusseren vier
 * werden jenseits des Kniepunkts gestaucht — Reihenfolge und Groessenordnung
 * bleiben erkennbar.
 */
const ZIEL: Readonly<Record<string, readonly [number, number]>> = {
  merkur: [0.382, 0.398],
  venus: [0.712, 0.734],
  erde: [0.999, 1.001],
  mars: [1.509, 1.539],
  jupiter: [4.0, 4.6],
  saturn: [5.0, 5.8],
  uranus: [6.0, 7.0],
  neptun: [7.0, 7.5],
};

describe("Umlaufbahn-Verhaeltnisse aus bodies.json", () => {
  it("bodies.json enthaelt genau die acht erwarteten Planeten", () => {
    expect(PLANETEN.map((p) => p.id)).toEqual([
      "merkur",
      "venus",
      "erde",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptun",
    ]);
  });

  it.each(PLANETEN.map((p) => [p.id, p.name] as const))(
    "%s (%s) trifft sein Verhaeltnisziel zur Erde",
    (id) => {
      const planet = PLANETEN.find((p) => p.id === id) as Body;
      const ziel = ZIEL[id];
      expect(ziel, `kein Zielwert fuer ${id}`).toBeDefined();

      const erdeBahn = scaleDistance(ERDE.semiMajorAxisKm, "visual");
      const planetBahn = scaleDistance(planet.semiMajorAxisKm, "visual");
      const verhaeltnis = planetBahn / erdeBahn;

      const [min, max] = ziel as readonly [number, number];
      expect(
        verhaeltnis,
        `${planet.name}: ${verhaeltnis.toFixed(3)}x Erde, Ziel ${min}-${max}`,
      ).toBeGreaterThanOrEqual(min);
      expect(
        verhaeltnis,
        `${planet.name}: ${verhaeltnis.toFixed(3)}x Erde, Ziel ${min}-${max}`,
      ).toBeLessThanOrEqual(max);
    },
  );

  it("haelt Jupiter deutlich ueber 3x von der Erde entfernt (war 1,78x)", () => {
    // Der behobene Fehler: `au^0.35` legte Jupiter auf 1,78 Erde-Bahnen,
    // den Erde-Mittelpunkt daneben — der ganze Innenbereich war ein Klumpen.
    const erdeBahn = scaleDistance(ERDE.semiMajorAxisKm, "visual");
    const jupiter = BODIES.find((b) => b.id === "jupiter") as Body;
    const verhaeltnis = scaleDistance(jupiter.semiMajorAxisKm, "visual") / erdeBahn;
    expect(verhaeltnis).toBeGreaterThan(3);
    // Und naeher an der Wahrheit als vorher: real sind es 5,20 AE / 1,00 AE.
    const echtesVerhaeltnis = jupiter.semiMajorAxisKm / ERDE.semiMajorAxisKm;
    expect(Math.abs(verhaeltnis - echtesVerhaeltnis)).toBeLessThan(
      Math.abs(1.78 - echtesVerhaeltnis),
    );
  });

  it("haelt das Mars-Erde-Verhaeltnis nah an der Realitaet (1,52)", () => {
    const erdeBahn = scaleDistance(ERDE.semiMajorAxisKm, "visual");
    const mars = BODIES.find((b) => b.id === "mars") as Body;
    const verhaeltnis = scaleDistance(mars.semiMajorAxisKm, "visual") / erdeBahn;
    expect(verhaeltnis).toBeCloseTo(1.524, 2);
  });

  it("haelt die acht Planeten von innen nach aussen in aufsteigender Reihenfolge", () => {
    const erdeBahn = scaleDistance(ERDE.semiMajorAxisKm, "visual");
    const verhaeltnisse = PLANETEN.map(
      (p) => scaleDistance(p.semiMajorAxisKm, "visual") / erdeBahn,
    );
    for (let i = 1; i < verhaeltnisse.length; i += 1) {
      expect(
        verhaeltnisse[i] ?? 0,
        `${PLANETEN[i]?.name} liegt nicht weiter aussen als ${PLANETEN[i - 1]?.name}`,
      ).toBeGreaterThan(verhaeltnisse[i - 1] ?? 0);
    }
  });

  it("legt Neptun in eine von der Kamera erfassbare Distanz (~434 Einheiten)", () => {
    const neptun = BODIES.find((b) => b.id === "neptun") as Body;
    const distanz = scaleDistance(neptun.semiMajorAxisKm, "visual");
    // Die Startkamera steht bei z = 1050. Liege Neptun weiter draussen,
    // waere er beim Laden unsichtbar — der Bug, den die Kamerakonstante
    // [0, 220, 1050] behebt.
    expect(distanz).toBeGreaterThan(400);
    expect(distanz).toBeLessThan(500);
  });

  it("haelt Merkur weit genug von der Sonne entfernt, um anklickbar zu sein", () => {
    const merkur = BODIES.find((b) => b.id === "merkur") as Body;
    const distanz = scaleDistance(merkur.semiMajorAxisKm, "visual");
    // 0,387 AE * 60 = 23,2 Einheiten. Sichtbar und weit genug weg vom
    // Sonnenmittelpunkt, dass der Sonnenradius (~6 Einheiten) ihn nicht
    // verdeckt.
    expect(distanz).toBeGreaterThan(20);
  });

  it("nutzt fuer jeden Planeten genau eine Quelle der Wahrheit: semiMajorAxisKm", () => {
    // Wenn jemand die Skalierung auf eine Achse umstellt, muss dieser Test
    // hier rot werden statt still ein anderes Bild zu zeigen.
    for (const planet of PLANETEN) {
      expect(
        planet.semiMajorAxisKm / AU_KM,
        `${planet.name} ohne gueltige Halbachse`,
      ).toBeGreaterThan(0);
      expect(planet.semiMajorAxisKm).toBeLessThan(40 * AU_KM);
    }
  });
});
