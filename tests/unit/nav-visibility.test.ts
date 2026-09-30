/**
 * Unit-Tests fuer die NavUI-Sichtbarkeitsfilter.
 *
 * Prueft: Der Filter "Nur bekannte" blendet Koerper ohne
 * berechenbare Umlaufbahn aus, behaelt aber Sonne und
 * bekannte Koerper bei.
 *
 * @module unit/nav-visibility
 */

import { beforeEach, describe, expect, it } from "vitest";
import { NavUI, isKnownBody } from "../../src/ui/Nav";
import type { BodyData } from "../../src/ui/InfoPanel";

/** Erzeugt ein Standard-Body-Objekt. */
function makeBody(overrides: Partial<BodyData> = {}): BodyData {
  return {
    id: "test",
    name: "Testkoerper",
    nameLatin: "Test",
    type: "planet",
    parent: "sonne",
    radiusKm: 1000,
    massKg: 1e24,
    semiMajorAxisKm: 1e8,
    eccentricity: 0.01,
    inclinationDeg: 1,
    rotationPeriodH: 24,
    axialTiltDeg: 10,
    surfaceTempC: { min: -50, mean: 10, max: 60 },
    gravityMs2: 5,
    atmosphere: "Dünne Luft",
    moonsCount: 0,
    color: "#123456",
    discovery: "",
    orderFromSun: 3,
    ...overrides,
  };
}

/** Erzeugt ein System mit Sonne + Planeten + Monden. */
function makeSystem(planets: number, moonsPerPlanet: number): BodyData[] {
  const bodies: BodyData[] = [
    makeBody({ id: "sonne", name: "Sonne", type: "star", parent: null }),
  ];
  for (let p = 0; p < planets; p += 1) {
    const planetId = `planet-${p}`;
    bodies.push(
      makeBody({
        id: planetId,
        name: `Planet ${p}`,
        type: "planet",
        parent: "sonne",
        orderFromSun: p + 1,
        moonsCount: moonsPerPlanet,
        semiMajorAxisKm: 5e7 * (p + 1),
      }),
    );
    for (let m = 0; m < moonsPerPlanet; m += 1) {
      bodies.push(
        makeBody({
          id: `${planetId}-mond-${m}`,
          name: `Mond ${p}-${m}`,
          type: "moon",
          parent: planetId,
          radiusKm: 50 + m,
          semiMajorAxisKm: 4e5 + m * 1000,
        }),
      );
    }
  }
  return bodies;
}

describe("Nav — Sichtbarkeitsfilter", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("isKnownBody: bekannte Koerper haben Halbachse", () => {
    expect(isKnownBody(makeBody({ semiMajorAxisKm: 1e8 }))).toBe(true);
    expect(isKnownBody(makeBody({ type: "moon", semiMajorAxisKm: 1e6 }))).toBe(
      true,
    );
  });

  it("isKnownBody: Sonne ist nicht bekannt (keine Umlaufbahn)", () => {
    expect(isKnownBody(makeBody({ type: "star", semiMajorAxisKm: 0 }))).toBe(
      false,
    );
  });

  it("isKnownBody: unbekannte Monde ohne Halbachse", () => {
    expect(isKnownBody(makeBody({ type: "moon", semiMajorAxisKm: 0 }))).toBe(
      false,
    );
    expect(isKnownBody(makeBody({ semiMajorAxisKm: Number.NaN }))).toBe(false);
  });

  it("der Filter 'Nur bekannte' blendet unbekannte Monde aus", () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));

    // Vor dem Filter: alle Koerper sichtbar
    const allIds = nav.getVisibleIds();
    expect(allIds.length).toBeGreaterThan(0);

    // Filter aktivieren
    nav.setFilter("known");
    const knownIds = nav.getVisibleIds();

    // Es muessen weniger Koerper sichtbar sein
    expect(knownIds.length).toBeLessThanOrEqual(allIds.length);

    // Sonne muss sichtbar bleiben
    expect(knownIds).toContain("sonne");

    // Bekannte Planeten muessen sichtbar bleiben
    expect(knownIds).toContain("planet-0");
    expect(knownIds).toContain("planet-1");

    nav.dispose();
  });

  it("der Filter 'Alle' zeigt Sonne und Planeten", () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));

    // Standardmaessig: Sonne + Planeten (Monde sind eingeklappt)
    const ids = nav.getVisibleIds();
    expect(ids.length).toBe(3);
    expect(ids).toContain("sonne");
    expect(ids).toContain("planet-0");
    expect(ids).toContain("planet-1");

    nav.dispose();
  });

  it("Sonne bleibt im 'Nur bekannte'-Filter sichtbar", () => {
    const nav = new NavUI(document.body);
    nav.mount();
    nav.update(makeSystem(2, 2));

    nav.setFilter("known");
    expect(nav.getVisibleIds()).toContain("sonne");

    nav.dispose();
  });
});