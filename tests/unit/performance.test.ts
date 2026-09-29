/**
 * Tests fuer die Performance-Schicht (Ticket 14).
 *
 * Abgedeckt: LOD-Cache (geteilte Geometrien, Hysterese), Instancing der
 * kleinen Monde, Ringsysteme (inkl. Incidence) und Asteroidenguertel samt
 * Kometen. Alles ohne WebGL — das echte Rendern messen die Playwright-Tests.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASTEROID_COUNT,
  Belt,
  BELT_INNER_AU,
  BELT_OUTER_AU,
  cometPosition,
  createAsteroids,
  createCometOrbits,
} from "../../src/scene/Belt";
import {
  InstancedMoons,
  FEATURED_MOON_IDS,
  isFeaturedMoon,
} from "../../src/scene/InstancedMoons";
import {
  LOD_SEGMENTS,
  applyLodByDistance,
  applyLodToMesh,
  disposeLodGeometries,
  getSphereGeometry,
  lodCacheSize,
  nextLodLevel,
  selectLodLevel,
} from "../../src/scene/LodCache";
import { Rings, createRingSystem, createRingTexture, updateRingVisibility } from "../../src/scene/Rings";
import { loadSceneBodies, safeRenderRadius } from "../../src/scene/types";
import type { SceneBody } from "../../src/scene/types";

const bodies = loadSceneBodies();

/** Baut ein kleines, gueltiges Test-Mesh. */
function makeMesh(radius: number, name = "test"): THREE.Mesh {
  const mesh = new THREE.Mesh();
  applyLodToMesh(mesh, "high", radius);
  mesh.name = name;
  return mesh;
}

afterEach(() => {
  disposeLodGeometries();
});

describe("LodCache", () => {
  it("erzeugt pro Detailstufe genau eine geteilte Geometrie", () => {
    const a = getSphereGeometry("high");
    const b = getSphereGeometry("high");
    const c = getSphereGeometry("low");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.parameters.widthSegments).toBe(LOD_SEGMENTS.high.width);
    expect(a.parameters.heightSegments).toBe(LOD_SEGMENTS.high.height);
    expect(c.parameters.widthSegments).toBe(LOD_SEGMENTS.low.width);
  });

  it("teilt die Geometrie zwischen hunderten Koerpern", () => {
    const geometries = new Set<THREE.BufferGeometry>();
    for (let i = 0; i < 465; i += 1) {
      geometries.add(getSphereGeometry("low"));
    }
    expect(geometries.size).toBe(1);
    expect(lodCacheSize()).toBe(1);
  });

  it("setzt den Radius in mesh.scale statt in der Geometrie", () => {
    const mesh = makeMesh(2.5);
    expect((mesh.geometry as THREE.SphereGeometry).parameters.radius).toBe(1);
    expect(mesh.scale.x).toBeCloseTo(2.5, 6);
    expect(mesh.userData["bodyRadius"]).toBe(2.5);
  });

  it("weicht mit der Distanz in drei Stufen ab", () => {
    expect(selectLodLevel(10, 10, "low")).toBe("high");
    expect(selectLodLevel(2000, 10, "high")).toBe("medium");
    expect(selectLodLevel(100_000, 10, "high")).toBe("low");
  });

  it("haelt die Hysterese ein: kein Pendeln im Grenzbereich", () => {
    // high -> medium: die high-Zone endet bei 40-fachem Radius. Bei 45x muss
    // `high` bleiben, weil 45 < 40 * 1.35 = 54 noch innerhalb der Hysterese
    // liegt. Bei 55x (jenseits von 54, aber noch weit unter 400) folgt medium.
    expect(nextLodLevel(45, 1, "high")).toBe("high");
    expect(nextLodLevel(55, 1, "high")).toBe("medium");

    // medium -> low: die medium-Zone endet bei 400-fachem Radius, die
    // Hysterese verlaegert sie auf 400 * 1.35 = 540.
    expect(nextLodLevel(500, 1, "medium")).toBe("medium");
    expect(nextLodLevel(541, 1, "medium")).toBe("low");

    // Heraufstufen passiert sofort — kein Kind wartet auf eine scharfe Kugel,
    // wenn es gerade auf einen Planeten zusteuert.
    expect(nextLodLevel(300, 1, "low")).toBe("medium");
    expect(nextLodLevel(10, 1, "low")).toBe("high");
    expect(nextLodLevel(39, 1, "medium")).toBe("high");
  });

  it("wechselt die Geometrie eines Mesh nur bei echtem Wechsel", () => {
    const mesh = makeMesh(1);
    const before = mesh.geometry;
    // Kamera weit weg, aber noch nicht weit genug fuer einen Wechsel.
    applyLodByDistance(mesh, new THREE.Vector3(50, 0, 0));
    expect(mesh.geometry).toBe(before);
    applyLodByDistance(mesh, new THREE.Vector3(100_000, 0, 0));
    expect(mesh.geometry).not.toBe(before);
    expect(mesh.userData["lodLevel"]).toBe("low");
  });

  it("lehnt ungueltige Radien ab", () => {
    const mesh = new THREE.Mesh();
    expect(() => applyLodToMesh(mesh, "high", 0)).toThrow(RangeError);
    expect(() => nextLodLevel(10, -1, "low")).toThrow(RangeError);
  });
});

describe("InstancedMoons", () => {
  it("haelt die sieben grossen Monde als Einzelmeshes fest", () => {
    expect(FEATURED_MOON_IDS.size).toBe(7);
    for (const id of FEATURED_MOON_IDS) {
      const body = bodies.find((b) => b.id === id);
      expect(body).toBeDefined();
      expect(isFeaturedMoon(body!)).toBe(true);
    }
  });

  it("gruppiert alle uebrigen Monde nach Elternkoerper", () => {
    const radii = new Map<string, number>();
    for (const body of bodies) {
      radii.set(body.id, safeRenderRadius(body, "visual"));
    }
    const instanced = new InstancedMoons(bodies, radii, "visual");

    const moons = bodies.filter((b) => b.type === "moon" && !isFeaturedMoon(b));
    expect(instanced.count).toBe(moons.length);
    expect(moons.length).toBeGreaterThan(400);
    // Ein Draw-Call je Elternkoerper, nicht je Mond.
    expect(instanced.groupCount).toBeLessThanOrEqual(8);
    expect(instanced.groupCount).toBeLessThan(moons.length / 10);
    instanced.dispose();
  });

  it("haengt jede Gruppe an ihr Eltern-Mesh", () => {
    const radii = new Map<string, number>();
    for (const body of bodies) {
      radii.set(body.id, safeRenderRadius(body, "visual"));
    }
    const instanced = new InstancedMoons(bodies, radii, "visual");
    const parents = new Map<string, THREE.Mesh>();
    for (const id of ["jupiter", "saturn", "uranus", "neptun", "mars"]) {
      parents.set(id, new THREE.Mesh());
    }
    instanced.attachTo(parents);
    const attached = [...parents.values()].filter((m) => m.children.length > 0);
    expect(attached.length).toBeGreaterThan(0);
    for (const parent of attached) {
      for (const child of parent.children) {
        expect(child).toBeInstanceOf(THREE.InstancedMesh);
      }
    }
    instanced.dispose();
  });

  it("laesst sich aus- und wieder einblenden", () => {
    const radii = new Map<string, number>();
    for (const body of bodies) {
      radii.set(body.id, safeRenderRadius(body, "visual"));
    }
    const instanced = new InstancedMoons(bodies, radii, "visual");
    const meshes = instanced.getObjectForTest();
    expect(meshes.length).toBeGreaterThan(0);
    instanced.setVisible(false);
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(false);
    }
    instanced.setVisible(true);
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(true);
    }
    instanced.dispose();
  });

  it("positioniert alle Instanzen bei jedem Zeitpunkt", () => {
    const radii = new Map<string, number>();
    for (const body of bodies) {
      radii.set(body.id, safeRenderRadius(body, "visual"));
    }
    const instanced = new InstancedMoons(bodies, radii, "visual");
    expect(() => instanced.update(2451545.0, "visual")).not.toThrow();
    expect(() => instanced.update(2452000.25, "visual")).not.toThrow();
    expect(() => instanced.update(Number.NaN, "visual")).toThrow(RangeError);
    instanced.dispose();
  });
});

describe("Rings", () => {
  it("erzeugt genau vier Ringsysteme", () => {
    const rings = new Rings(bodies, "visual");
    expect(rings.count).toBe(4);
    rings.dispose();
  });

  it("gibt es nur fuer die vier Planeten mit Ringen", () => {
    for (const body of bodies) {
      if (body.type !== "planet") {
        expect(createRingSystem(body, "visual")).toBeNull();
      }
    }
    const saturn = bodies.find((b) => b.id === "saturn")!;
    expect(createRingSystem(saturn, "visual")).not.toBeNull();
  });

  it("erzeugt Luecken im Alpha-Verlauf der Ringtextur", () => {
    const saturn = bodies.find((b) => b.id === "saturn")!;
    const ring = createRingSystem(saturn, "visual")!;
    const texture = ring.mesh.material as THREE.MeshBasicMaterial;
    const data = (texture.map as THREE.DataTexture).image.data as Uint8Array;
    let transparent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) {
        transparent += 1;
      }
    }
    // Die Cassini-Luecke muss im Textur-Alpha sichtbar sein.
    expect(transparent).toBeGreaterThan(10);
    ring.dispose();
  });

  it("blendet die Ringe in der Ringebene aus (Incidence)", () => {
    const saturn = bodies.find((b) => b.id === "saturn")!;
    const ring = createRingSystem(saturn, "visual")!;
    const planet = new THREE.Mesh();
    planet.add(ring.mesh);
    planet.updateMatrixWorld(true);

    // Der Ring liegt in der XZ-Ebene (Normale = Y). Eine Kamera in dieser
    // Ebene sieht ihn nur als unendlich duenne Linie: Ringe unsichtbar.
    const flat = updateRingVisibility(ring, new THREE.Vector3(200, 0, 0), 0.85);
    expect(flat).toBe(0);
    expect(ring.mesh.visible).toBe(false);

    // Kamera entlang der Normalen (von "oben"): Ringe voll sichtbar.
    const above = updateRingVisibility(ring, new THREE.Vector3(0, 200, 0), 0.85);
    expect(above).toBeCloseTo(0.85, 5);
    expect(ring.mesh.visible).toBe(true);

    // Knapp ausserhalb des Kegels (6 Grad) wird weich eingeblendet: bei
    // 45 Grad Hoehe auf 200 Abstand liegt der Winkel zur Ebene bei ~12,7 Grad,
    // also mitten im Verlauf und deutlich unter voller Deckkraft.
    const shallow = updateRingVisibility(ring, new THREE.Vector3(200, 45, 0), 0.85);
    expect(shallow).toBeGreaterThan(0);
    expect(shallow).toBeLessThan(0.85);
    ring.dispose();
  });

  it("lehnt eine ungueltige Deckkraft ab", () => {
    const saturn = bodies.find((b) => b.id === "saturn")!;
    const ring = createRingSystem(saturn, "visual")!;
    expect(() =>
      updateRingVisibility(ring, new THREE.Vector3(0, 100, 0), 5),
    ).toThrow(RangeError);
    ring.dispose();
  });

  it("erzeugt die Ringtextur nur mit gueltiger Breite", () => {
    expect(() => createRingTexture({ inner: 1, outer: 2, opacity: 1, color: 0, gaps: [] }, 1)).toThrow(
      RangeError,
    );
  });
});

describe("Belt", () => {
  it("erzeugt mindestens 3000 Asteroiden im Guertel", () => {
    expect(DEFAULT_ASTEROID_COUNT).toBeGreaterThanOrEqual(3000);
    const asteroids = createAsteroids(DEFAULT_ASTEROID_COUNT);
    expect(asteroids).toHaveLength(DEFAULT_ASTEROID_COUNT);
    for (const a of asteroids) {
      const au = a.semiMajorAxisKm / 149_597_870.7;
      expect(au).toBeGreaterThanOrEqual(BELT_INNER_AU - 0.001);
      expect(au).toBeLessThanOrEqual(BELT_OUTER_AU + 0.001);
      expect(a.radius).toBeGreaterThan(0);
    }
  });

  it("ist deterministisch: gleicher Seed, gleiche Daten", () => {
    const a = createAsteroids(500);
    const b = createAsteroids(500);
    const c = createAsteroids(500, 12345);
    expect(a.map((x) => x.semiMajorAxisKm)).toEqual(b.map((x) => x.semiMajorAxisKm));
    expect(a.map((x) => x.radius)).toEqual(b.map((x) => x.radius));
    expect(a.map((x) => x.semiMajorAxisKm)).not.toEqual(c.map((x) => x.semiMajorAxisKm));
  });

  it("braucht eine positive Anzahl", () => {
    expect(() => createAsteroids(0)).toThrow(RangeError);
  });

  it("braucht genau einen Draw-Call fuer den ganzen Guertel", () => {
    const belt = new Belt("visual");
    const stats = belt.getStats();
    expect(stats.asteroids).toBe(DEFAULT_ASTEROID_COUNT);
    expect(stats.drawCalls).toBe(1 + stats.comets);
    expect(stats.comets).toBeGreaterThanOrEqual(2);
    expect(stats.comets).toBeLessThanOrEqual(3);
    belt.dispose();
  });

  it("liefert 2-3 Kometen auf stark exzentrischen Bahnen (e >= 0,9)", () => {
    const belt = new Belt("visual");
    const object = belt.getObject();
    const comets = object.children.filter(
      (c) => c instanceof THREE.Mesh && c.name.startsWith("komet-"),
    );
    expect(comets.length).toBeGreaterThanOrEqual(2);
    expect(comets.length).toBeLessThanOrEqual(3);
    belt.dispose();
  });

  it("gibt jeder Kometenbahn eine Exzentrizitaet von mindestens 0,9", () => {
    for (const orbit of createCometOrbits()) {
      expect(orbit.eccentricity).toBeGreaterThanOrEqual(0.9);
      expect(orbit.eccentricity).toBeLessThan(1);
    }
  });

  it("setzt Kometen auf eine stark elliptische Bahn", () => {
    // Halley-artige Bahn: 17,8 AE Halbachse, e = 0,967. Das Aphel liegt bei
    // a(1+e) = 35 AE, also weit ausserhalb der Erdbahn (1 AE).
    const halley = {
      id: "halley",
      parent: "sonne",
      semiMajorAxisKm: 17.8 * 149_597_870.7,
      eccentricity: 0.967,
      inclinationDeg: 162,
      rotationPeriodH: 52,
    };
    // "log"-Modus: nichtlineare Distanzen, deshalb grosszuegige Schranke.
    const positions = [
      cometPosition(halley, 2451545.0, "log"),
      cometPosition(halley, 2460000.0, "log"),
      cometPosition(halley, 2470000.5, "log"),
    ];
    // Mindestens eine Position liegt weit ausserhalb des Erdbahnradius.
    expect(Math.max(...positions.map((p) => p.length()))).toBeGreaterThan(10);
    // Und keine Position ist exakt der Nullpunkt.
    for (const p of positions) {
      expect(p.length()).toBeGreaterThan(0);
    }
    expect(() => cometPosition(halley, Number.NaN, "real")).toThrow(RangeError);
  });

  it("positioniert Guertel und Kometen bei jedem Zeitpunkt", () => {
    const belt = new Belt("visual");
    expect(() => belt.update(2451545.0)).not.toThrow();
    expect(() => belt.update(2460000.5)).not.toThrow();
    expect(() => belt.update(Number.NaN)).toThrow(RangeError);
    belt.dispose();
  });
});

describe("Datenlage (465 Koerper)", () => {
  it("haelt die in Ticket 14 geforderte Koerperzahl ein", () => {
    expect(bodies.length).toBeGreaterThan(450);
  });

  it("rendert Koerper ohne Radiusangabe statt abzubrechen", () => {
    const tiny = bodies.find((b) => b.id === "saturn-s2009s2") as SceneBody;
    expect(safeRenderRadius(tiny, "visual")).toBeGreaterThan(0);
  });
});
