/**
 * Validierung der astronomischen Grunddaten in `src/data/bodies.json`.
 *
 * Geprueft wird das, was ein Kind in der 3D-Szene wirklich sieht: ein
 * vorhandener Planet, ein erreichbarer Mond, eine Zahl, die nicht
 * erfunden ist.
 *
 * Die JSON-Dateien werden per `import` geladen — `resolveJsonModule` ist in
 * diesem Projekt aktiv und `tests/unit/format.test.ts` macht es genauso. So
 * prueft Vitest exakt die Datei, die auch `vite build` einbindet, und es
 * braucht keine zusaetzliche Typ-Abhaengigkeit (`@types/node` ist nicht
 * installiert, `node:fs` waere damit nicht typisiert).
 *
 * @module tests/unit/astronomy.test
 */

import { describe, expect, it } from "vitest";

import bodiesJson from "../../src/data/bodies.json";
import factsJson from "../../src/data/facts.json";

/** Ein Koerper aus bodies.json. */
interface Body {
  readonly id: string;
  readonly name: string;
  readonly type: "star" | "planet" | "moon";
  readonly parent: string | null;
  readonly radiusKm: number;
  readonly massKg: number;
  readonly semiMajorAxisKm: number;
  readonly eccentricity: number;
  readonly inclinationDeg: number;
  readonly rotationPeriodH: number;
  readonly moonsCount: number;
}

interface BodiesFile {
  readonly bodies: readonly Body[];
}

interface FactsFile {
  readonly bodies: Readonly<Record<string, unknown>>;
}

const bodiesFile = bodiesJson as BodiesFile;
const factsFile = factsJson as FactsFile;

const bodies = bodiesFile.bodies;
const byId = new Map(bodies.map((b) => [b.id, b]));

/**
 * Belegte Monde je Planet (Wikipedia-Infobox `satellites`, Stand 2026-09).
 * tolerance = 5, weil einzelne Kleinmonde ohne Radius in der Tabelle
 * stehen und dann nicht als eigener Eintrag gefuehrt werden.
 */
const WIKIPEDIA_MOONS: Readonly<Record<string, number>> = {
  erde: 1,
  mars: 2,
  jupiter: 115,
  saturn: 293,
  uranus: 29,
  neptun: 16,
};

/** Belegte Rotationszeiten in Stunden (Wikipedia, Stand 2026-09). */
const REFERENCE_ROTATION_H: Readonly<Record<string, number>> = {
  sonne: 609.0,
  merkur: 1407.6,
  venus: -5832.5,
  erde: 23.934,
  mars: 24.623,
  jupiter: 9.925,
  saturn: 10.543,
  uranus: -17.24,
  neptun: 16.11,
};

/** Ein Mond ohne Radius in der Wikipedia-Tabelle (S/2009 S 2). */
const BODIES_WITHOUT_RADIUS: ReadonlySet<string> = new Set(["saturn-s2009s2"]);

describe("bodies.json Grundstruktur", () => {
  it("ist valides JSON mit mindestens 456 Koerpern", () => {
    expect(Array.isArray(bodies)).toBe(true);
    // 1 Sonne + 8 Planete + 456 Monde = 465
    expect(bodies.length).toBeGreaterThanOrEqual(456);
  });

  it("hat fuer jeden Koerper eine eindeutige id", () => {
    const ids = bodies.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("verweist bei jedem Koerper auf einen existierenden parent", () => {
    const broken = bodies
      .filter((b) => b.parent !== null && !byId.has(b.parent))
      .map((b) => b.id);
    expect(broken).toEqual([]);
  });

  it("hat genau eine Sonne und genau acht Planete", () => {
    expect(bodies.filter((b) => b.type === "star")).toHaveLength(1);
    expect(bodies.filter((b) => b.type === "planet")).toHaveLength(8);
  });

  it("haelt bei jedem Planeten die Wikipedia-Mondezahl ein", () => {
    for (const [id, expected] of Object.entries(WIKIPEDIA_MOONS)) {
      const actual = bodies.filter(
        (b) => b.type === "moon" && b.parent === id,
      ).length;
      expect(actual, `${id}: ${actual} Monde, Wikipedia nennt ${expected}`)
        .toBeGreaterThanOrEqual(expected - 5);
    }
  });
});

describe("bodies.json Koerperzahlen", () => {
  it("nutzt bei jedem Koerper einen Radius groesser als 0", () => {
    const broken = bodies
      .filter((b) => b.radiusKm <= 0 && !BODIES_WITHOUT_RADIUS.has(b.id))
      .map((b) => b.id);
    expect(broken).toEqual([]);
  });

  it("nutzt bei jedem Koerper eine Masse groesser als 0", () => {
    const broken = bodies
      .filter((b) => b.massKg <= 0 && !BODIES_WITHOUT_RADIUS.has(b.id))
      .map((b) => b.id);
    expect(broken).toEqual([]);
  });

  it("legt jeden Mond ausserhalb seines Planeten", () => {
    const broken = bodies
      .filter(
        (b) =>
          b.type === "moon" &&
          b.radiusKm > 0 &&
          b.semiMajorAxisKm <= b.radiusKm,
      )
      .map((b) => `${b.id}: a=${b.semiMajorAxisKm} r=${b.radiusKm}`);
    expect(broken).toEqual([]);
  });

  it("haelt jede Exzentrizitaet zwischen 0 und 1", () => {
    const broken = bodies
      .filter((b) => b.eccentricity < 0 || b.eccentricity >= 1)
      .map((b) => b.id);
    expect(broken).toEqual([]);
  });

  it("zaehlt bei jedem Planeten die Monde aus bodies.json", () => {
    const broken = bodies
      .filter((b) => b.type === "planet")
      .filter((b) => {
        const actual = bodies.filter(
          (m) => m.type === "moon" && m.parent === b.id,
        ).length;
        return b.moonsCount !== actual;
      })
      .map((b) => `${b.id}: ${b.moonsCount} statt ${bodies.length}`);
    expect(broken).toEqual([]);
  });
});

describe("bodies.json Rotation", () => {
  it("traegt die neun belegten Rotationszeiten (Toleranz 1 %)", () => {
    for (const [id, expected] of Object.entries(REFERENCE_ROTATION_H)) {
      const body = byId.get(id);
      expect(body, `${id} fehlt`).toBeDefined();
      if (!body) continue;
      const delta = Math.abs(body.rotationPeriodH - expected);
      expect(delta, `${id}: ${body.rotationPeriodH} statt ${expected} h`)
        .toBeLessThanOrEqual(Math.abs(expected) * 0.01);
    }
  });

  it("laesst Venus und Uranus rueckwaerts rotieren", () => {
    expect(byId.get("venus")?.rotationPeriodH).toBeLessThan(0);
    expect(byId.get("uranus")?.rotationPeriodH).toBeLessThan(0);
  });

  it("dreht die uebrigen Planeten im Uhrzeigersinn", () => {
    const retrograde = bodies
      .filter(
        (b) =>
          b.type === "planet" && b.id !== "venus" && b.id !== "uranus",
      )
      .filter((b) => b.rotationPeriodH <= 0)
      .map((b) => b.id);
    expect(retrograde).toEqual([]);
  });
});

describe("facts.json Vollstaendigkeit", () => {
  it("hat fuer jeden Planeten einen Eintrag", () => {
    const missing = bodies
      .filter((b) => b.type === "planet")
      .filter((b) => !(b.id in factsFile.bodies))
      .map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("hat fuer jeden Mond einen Eintrag", () => {
    const missing = bodies
      .filter((b) => b.type === "moon")
      .filter((b) => !(b.id in factsFile.bodies))
      .map((b) => b.id);
    expect(missing).toEqual([]);
  });

  it("haelt keinen fact-Eintrag ohne Koerper", () => {
    const orphan = Object.keys(factsFile.bodies).filter(
      (id) => !byId.has(id),
    );
    expect(orphan).toEqual([]);
  });
});

describe("bodies.json Monde", () => {
  it("verweist bei jedem Mond auf einen existierenden Planeten", () => {
    const broken = bodies
      .filter((b) => b.type === "moon")
      .filter((b) => {
        const parent = b.parent === null ? undefined : byId.get(b.parent);
        return parent?.type !== "planet";
      })
      .map((b) => `${b.id} -> ${b.parent ?? "null"}`);
    expect(broken).toEqual([]);
  });

  it("gibt provisionalen Bezeichnungen eindeutige ids", () => {
    // 56 der 456 Monde haben noch keine offizielle Namensgebung
    // (Saturn: "S/2003 S 1" u.ae.). Deren id ist "<planet>-<bezeichnung>".
    const designations = bodies.filter((b) =>
      /^[a-z]+-s\d{4}[a-z]{1,3}\d+$/.test(b.id),
    );
    expect(designations.length).toBeGreaterThan(50);
    const ids = designations.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(designations.every((b) => b.name.startsWith("S/"))).toBe(true);
  });

  it("haelt fuer jeden Mond eine Umlaufzeit als Rotationsperiode", () => {
    const broken = bodies
      .filter((b) => b.type === "moon")
      .filter((b) => b.rotationPeriodH === 0)
      .map((b) => b.id);
    expect(broken).toEqual([]);
  });
});
