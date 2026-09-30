/**
 * Unit-Tests fuer `scaleRadiusDynamic`.
 *
 * Prueft:
 *  - Weit weg -> visual radius
 *  - Sehr nah  -> real radius
 *  - Uebergang  -> Interpolation
 *  - Fehlerhafte Eingaben
 *
 * @module unit/scale-dynamic
 */

import { describe, expect, it } from "vitest";
import { scaleRadiusDynamic, scaleRadius } from "../../src/core/scale";

describe("scaleRadiusDynamic", () => {
  it("gibt im Ueberblick (weit weg) den visual-Radius zurueck", () => {
    // Erde: visual ~0.5, real ~3.66. Weit weg -> visual.
    const radius = scaleRadiusDynamic(6371, 100, "visual");
    expect(radius).toBeCloseTo(scaleRadiusDynamic(6371, 1000, "visual"), 5);
  });

  it("gibt im Nahbereich den real-Radius zurueck", () => {
    // Sehr nah -> real radius.
    const visual = scaleRadiusDynamic(6371, 1000, "visual");
    const real = scaleRadiusDynamic(6371, 0.1, "visual");
    expect(real).toBeGreaterThan(visual);
  });

  it("real Radius ist bei 0 km Entfernung gleich scaleRadius(..., 'real')", () => {
    const real = scaleRadiusDynamic(6371, 0, "visual");
    expect(real).toBeCloseTo(scaleRadius(6371, "real"), 5);
  });

  it("wirft bei negativem radiusKm", () => {
    expect(() => scaleRadiusDynamic(-1, 10, "visual")).toThrow(RangeError);
  });

  it("wirft bei zero radiusKm", () => {
    expect(() => scaleRadiusDynamic(0, 10, "visual")).toThrow(RangeError);
  });

  it("wirft bei NaN distanceFromCamera", () => {
    expect(() => scaleRadiusDynamic(6371, NaN, "visual")).toThrow(RangeError);
  });

  it("wirft bei negativem distanceFromCamera", () => {
    expect(() => scaleRadiusDynamic(6371, -1, "visual")).toThrow(RangeError);
  });

  it("monoton fallend mit der Entfernung (nah = real > weit = visual)", () => {
    // Erde: visual ~1.88, overviewDist~47, travelDist~7.5
    // d1=1 (nah, real), d2=20 (Uebergang), d3=100 (weit, visual)
    const d1 = scaleRadiusDynamic(6371, 1, "visual");
    const d2 = scaleRadiusDynamic(6371, 20, "visual");
    const d3 = scaleRadiusDynamic(6371, 100, "visual");
    expect(d1).toBeGreaterThan(d2);
    expect(d2).toBeGreaterThan(d3);
  });

  it("liefert fuer 'compact' Modus einen gueltigen Wert", () => {
    const radius = scaleRadiusDynamic(6371, 50, "compact");
    expect(radius).toBeGreaterThan(0);
    expect(Number.isFinite(radius)).toBe(true);
  });

  it("liefert fuer 'real' Modus einen gueltigen Wert", () => {
    const radius = scaleRadiusDynamic(6371, 50, "real");
    expect(radius).toBeGreaterThan(0);
    expect(Number.isFinite(radius)).toBe(true);
  });
});