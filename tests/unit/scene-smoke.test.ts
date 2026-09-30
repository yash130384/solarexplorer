/**
 * Smoke-Tests fuer die 3D-Szene (Ticket 06).
 *
 * `WebGLRenderer` braucht einen echten GPU-Kontext, den jsdom nicht liefert.
 * Geprueft werden deshalb alles ohne WebGL: Datensatz, Starfield (inklusive
 * Determinismus), BodyFactory, OrbitLines und die SceneManager-API. Das
 * tatsaechliche Rendern decken die Playwright-Tests ab.
 */
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BodyFactory } from "../../src/scene/BodyFactory";
import { disposeLodGeometries } from "../../src/scene/LodCache";
import { OrbitLines } from "../../src/scene/OrbitLines";
import {
  detectQualityLevel,
  getQualityProfile,
  isSoftwareRenderer,
} from "../../src/scene/quality";
import { SceneManager } from "../../src/scene/SceneManager";
import { Starfield, mulberry32 } from "../../src/scene/Starfield";
import {
  emptyFrameSample,
  loadSceneBodies,
  safeRenderRadius,
} from "../../src/scene/types";
import type { SceneOptions } from "../../src/scene/types";

const bodies = loadSceneBodies();
const options: SceneOptions = { scaleMode: "visual", distanceMode: "visual" };

/** Erzeugt ein Canvas, wie es der `SceneManager` erwartet. */
function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  return canvas;
}

describe("Datenbasis", () => {
  it("liefert Sonne, 8 Planeten und mindestens 8 Monde", () => {
    expect(bodies.filter((b) => b.type === "star")).toHaveLength(1);
    expect(bodies.filter((b) => b.type === "planet")).toHaveLength(8);
    expect(bodies.filter((b) => b.type === "moon").length).toBeGreaterThanOrEqual(8);
  });

  it("rendert jeden Koerper — auch ohne Radiusangabe — mit einem Radius > 0", () => {
    // `bodies.json` hatte zwischenzeitlich Koerper mit `radiusKm: 0.0`
    // (unbekannte Groesse). `safeRenderRadius` faengt das ab, damit ein
    // unvollstaendiger Datensatz nicht die ganze Szene lahmlegt.
    for (const body of bodies) {
      expect(safeRenderRadius(body, "visual")).toBeGreaterThan(0);
    }
  });

  it("nutzt fuer jeden Koerper eine gueltige Farbe", () => {
    for (const body of bodies) {
      expect(body.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("Starfield", () => {
  it("ist bei gleichem Seed reproduzierbar", () => {
    const a = new Starfield(500, 1000, 12345);
    const b = new Starfield(500, 1000, 12345);
    const posA = a.getObject().geometry.getAttribute("position").array as Float32Array;
    const posB = b.getObject().geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
  });

  it("erzeugt bei anderem Seed andere Sterne", () => {
    const a = new Starfield(500, 1000, 1);
    const b = new Starfield(500, 1000, 2);
    const posA = a.getObject().geometry.getAttribute("position").array as Float32Array;
    const posB = b.getObject().geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(posA)).not.toEqual(Array.from(posB));
  });

  it("platziert alle Sterne exakt auf der Kugeloberflaeche", () => {
    const field = new Starfield(300, 1000, 7);
    const pos = field.getObject().geometry.getAttribute("position").array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      const len = Math.hypot(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0);
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeCloseTo(1000, 3);
    }
  });

  it("liefert bei mulberry32 gleiche Folgen fuer gleiche Seeds", () => {
    expect(mulberry32(7)()).toBe(mulberry32(7)());
  });

  it("liefert Werte im Intervall [0, 1)", () => {
    const random = mulberry32(99);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("lehnt ungueltige Parameter ab", () => {
    expect(() => new Starfield(0, 100)).toThrow(RangeError);
    expect(() => new Starfield(10, 0)).toThrow(RangeError);
  });

  it("gibt Geometrie UND Material frei", () => {
    const field = new Starfield(100, 1000, 3);
    const geometrySpy = vi.spyOn(field.getObject().geometry, "dispose");
    const material = field.getObject().material as THREE.Material;
    const materialSpy = vi.spyOn(material, "dispose");
    field.dispose();
    expect(geometrySpy).toHaveBeenCalled();
    expect(materialSpy).toHaveBeenCalled();
  });
});

describe("BodyFactory", () => {
  it("erzeugt fuer jeden Koerper ein Mesh mit gueltiger, geteilter Geometrie", () => {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const body of bodies) {
      const mesh = BodyFactory.create(body, "visual", "visual");
      // Die Geometrie ist eine Einheitskugel aus dem LOD-Cache; der Radius
      // steckt in `mesh.scale`.
      expect(mesh.scale.x).toBeGreaterThan(0);
      geometries.add(mesh.geometry);
      expect(mesh.userData["bodyId"]).toBe(body.id);
      BodyFactory.dispose(mesh);
    }
    // 465 Koerper, aber hoechstens 3 verschiedene Kugelgeometrien.
    expect(bodies.length).toBeGreaterThan(100);
    expect(geometries.size).toBeLessThanOrEqual(3);
  });

  it("haengt der Sonne eine additive Gluehhaelle an", () => {
    const sun = bodies.find((b) => b.type === "star");
    expect(sun).toBeDefined();
    const mesh = BodyFactory.create(sun!, "visual", "visual");
    expect(mesh.children.length).toBe(1);
    const glow = mesh.children[0] as THREE.Mesh;
    const material = glow.material as THREE.MeshBasicMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    BodyFactory.dispose(mesh);
  });

  it("nutzt die hohe Detailstufe fuer die Sonne und `low` fuer ferne Planeten", () => {
    const sun = bodies.find((b) => b.type === "star")!;
    const neptune = bodies.find((b) => b.id === "neptun")!;
    const sunMesh = BodyFactory.create(sun, "visual", "visual");
    const nepMesh = BodyFactory.create(neptune, "visual", "visual");
    expect(sunMesh.userData["lodLevel"]).toBe("high");
    expect(nepMesh.userData["lodLevel"]).toBe("low");
    expect((sunMesh.geometry as THREE.SphereGeometry).parameters.widthSegments).toBe(48);
    expect((nepMesh.geometry as THREE.SphereGeometry).parameters.widthSegments).toBe(12);
    BodyFactory.dispose(sunMesh);
    BodyFactory.dispose(nepMesh);
  });

  it("kippt die Rotationsachse um axialTiltDeg", () => {
    const earth = bodies.find((b) => b.id === "erde")!;
    const mesh = BodyFactory.create(earth, "visual", "visual");
    expect(THREE.MathUtils.radToDeg(mesh.rotation.z)).toBeCloseTo(earth.axialTiltDeg, 5);
    BodyFactory.dispose(mesh);
  });

  it("gibt das Material frei und laesst geteilte Geometrien im Cache", () => {
    const body = bodies[1]!;
    const mesh = BodyFactory.create(body, "visual", "visual");
    const geometrySpy = vi.spyOn(mesh.geometry, "dispose");
    const materialSpy = vi.spyOn(mesh.material as THREE.Material, "dispose");
    BodyFactory.dispose(mesh);
    // Die Kugel ist geteilt: sie darf beim Abau eines einzelnen Koerpers
    // nicht freigegeben werden, sonst waeren alle anderen Koerper kaputt.
    expect(geometrySpy).not.toHaveBeenCalled();
    expect(materialSpy).toHaveBeenCalled();
    disposeLodGeometries();
  });
});

describe("Grafikqualitaet (scene/quality)", () => {
  it("erkennt Software-Rasterisierer", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
  });

  it("erkennt echte GPUs nicht als Software", () => {
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)")).toBe(false);
    expect(isSoftwareRenderer("Apple M2 Pro")).toBe(false);
    expect(isSoftwareRenderer("Adreno (TM) 740")).toBe(false);
  });

  it("waehlt bei Software-Rasterisierung die sparsame Stufe", () => {
    expect(detectQualityLevel("SwiftShader driver")).toBe("low");
  });

  it("spart auf der sparsamen Stufe genau die teuren Dinge", () => {
    const low = getQualityProfile("low");
    const high = getQualityProfile("high");
    // Ohne GPU ist Kantenglaettung (Mehrfach-Sampling) der teuerste
    // Einzelposten — Pixel-Ratio 2 vervierfacht die Fuellrate.
    expect(low.antialias).toBe(false);
    expect(low.maxPixelRatio).toBe(1);
    expect(high.antialias).toBe(true);
    expect(low.starCount).toBeLessThan(high.starCount);
  });

  it("lehnt unbekannte Stufen ab", () => {
    expect(() => getQualityProfile("ultra" as never)).toThrow(RangeError);
  });
});

describe("OrbitLines", () => {
  it("verschmilzt die Planetenbahnen zu genau einer Linie", () => {
    const lines = new OrbitLines(bodies, "visual");
    // Draw-Call-Optimierung: alle Planetenbahnen liegen in einem Mesh.
    expect(lines.getObject()).toBeInstanceOf(THREE.LineSegments);
    expect(lines.getPlanetBodyIds()).toEqual(
      bodies.filter((b) => b.type === "planet").map((b) => b.id),
    );
    lines.dispose();
  });

  it("verschmilzt die Mondbahnen je Elternkoerper zu einer Linie", () => {
    const lines = new OrbitLines(bodies, "visual");
    const expectedParents = new Set(
      bodies.filter((b) => b.type === "moon" && b.parent !== null).map((b) => b.parent),
    );
    const actual = [...lines.getMoonLines().keys()];
    expect(new Set(actual)).toEqual(expectedParents);
    // Eine Linie je Eltern, nicht eine je Mond — das ist der Draw-Call-Gewinn.
    expect(actual.length).toBe(expectedParents.size);
    // Jede Mondbahn ist als geschlossenes Polygon (Punktpaare) drin.
    let segments = 0;
    for (const line of lines.getMoonLines().values()) {
      const count = line.geometry.getAttribute("position").count;
      expect(count % 2).toBe(0);
      segments += count / 2;
    }
    expect(segments).toBe(bodies.filter((b) => b.type === "moon").length * 72);
    lines.dispose();
  });

  it("verwendet mindestens 180 Segmente pro Planetenbahn", () => {
    const lines = new OrbitLines(bodies, "visual");
    const planets = bodies.filter((b) => b.type === "planet").length;
    const points = lines.getObject().geometry.getAttribute("position").count;
    // Jede Bahn hat >= 180 Stuetzpunkte, jeder Punkt zaehlt als 2 Endpunkte.
    expect(points / 2 / planets).toBeGreaterThanOrEqual(180);
    lines.dispose();
  });

  it("erzeugt nur endliche Koordinaten", () => {
    const lines = new OrbitLines(bodies, "visual");
    const all: Float32Array[] = [
      lines.getObject().geometry.getAttribute("position").array as Float32Array,
    ];
    for (const line of lines.getMoonLines().values()) {
      all.push(line.geometry.getAttribute("position").array as Float32Array);
    }
    const allFinite = all.every((arr) => arr.every((v) => Number.isFinite(v)));
    lines.dispose();
    expect(allFinite).toBe(true);
  });

  it("haengt Mondbahnen an existierende Eltern-Gruppen", () => {
    const lines = new OrbitLines(bodies, "visual");
    for (const [parentId, line] of lines.getMoonLines()) {
      expect(bodies.some((b) => b.id === parentId)).toBe(true);
      expect(line.userData["parentId"]).toBe(parentId);
    }
    lines.dispose();
  });

  it("haelt Mondbahnen ueber setVisible(true) verborgen", () => {
    const lines = new OrbitLines(bodies, "visual");
    lines.setVisible(true);
    for (const line of lines.getMoonLines().values()) {
      expect(line.visible).toBe(false);
    }
    // Planetenbahnen bleiben immer sichtbar.
    expect(lines.getObject().visible).toBe(true);
    lines.dispose();
  });

  it("gibt Geometrie UND Material frei", () => {
    const lines = new OrbitLines(bodies, "visual");
    const planet = lines.getObject();
    const moon = [...lines.getMoonLines().values()][0];
    if (moon === undefined) {
      throw new Error("Es gibt keine Mondbahn — Testdaten unvollstaendig.");
    }
    const geometrySpy = vi.spyOn(planet.geometry, "dispose");
    const materialSpy = vi.spyOn(planet.material as THREE.Material, "dispose");
    const moonGeometrySpy = vi.spyOn(moon.geometry, "dispose");
    const moonMaterialSpy = vi.spyOn(moon.material as THREE.Material, "dispose");
    lines.dispose();
    expect(geometrySpy).toHaveBeenCalled();
    expect(materialSpy).toHaveBeenCalled();
    expect(moonGeometrySpy).toHaveBeenCalled();
    expect(moonMaterialSpy).toHaveBeenCalled();
  });
});

describe("Frame-Messung ohne Renderer (scene/types)", () => {
  it("liefert Nullwerte statt zu haengen", async () => {
    // Ohne WebGL (jsdom) gibt es keinen Backbuffer. `sampleFrame` muss dann
    // trotzdem ein Ergebnis liefern — ein `await` darf nicht endlos warten.
    const manager = new SceneManager(makeCanvas(), options);
    const sample = await manager.sampleFrame({ x: 0, y: 0, width: 8, height: 8 });
    expect(sample).toEqual({
      maxLuminance: 0,
      meanLuminance: 0,
      brightPixels: 0,
      corePixels: 0,
      totalPixels: 0,
    });
    manager.dispose();
  });

  it("beantwortet auch nach dispose, statt zu haengen", async () => {
    // Nach `dispose` zeichnet die Szene keine Bilder mehr. Ohne Antwort
    // bliebe der Promise des Aufrufers offen.
    const manager = new SceneManager(makeCanvas(), options);
    manager.dispose();
    await expect(
      manager.sampleFrame({ x: 0, y: 0, width: 8, height: 8 }),
    ).resolves.toEqual(emptyFrameSample());
  });

  it("bedient parallele Messungen alle", async () => {
    // Zwei Aufrufe ohne `await` dazwischen: beide muessen beantwortet werden.
    // Vorher verdraengte der zweite den ersten, dessen `await` haengte ewig.
    const manager = new SceneManager(makeCanvas(), options);
    const both = Promise.all([
      manager.sampleFrame({ x: 0, y: 0, width: 8, height: 8 }),
      manager.sampleFrame({ x: 1, y: 1, width: 4, height: 4 }),
    ]);
    // Ohne Renderer loest `sampleFrame` sofort auf; der Test haelt den Fall
    // fest, dass zweimal hintereinander nichts haengt.
    const [first, second] = await both;
    expect(first).toEqual(emptyFrameSample());
    expect(second).toEqual(emptyFrameSample());
    expect(first).not.toBe(second);
    manager.dispose();
  });
});

describe("emptyFrameSample", () => {
  it("gibt pro Aufruf ein eigenes Objekt zurueck", () => {
    // Kein geteiltes Objekt: sonst wuerde eine spaetere Messung die Werte
    // einer frueheren ueberschreiben.
    const a = emptyFrameSample();
    const b = emptyFrameSample();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("SceneManager (ohne WebGL)", () => {
  it("baut Szene und Kamera auf", () => {
    const manager = new SceneManager(makeCanvas(), options);
    expect(manager.getScene().name).toBe("SolarExplorer");
    expect(manager.getCamera().far).toBe(5_000_000);
    expect(manager.getJulianDate()).toBe(2451545.0);
    manager.dispose();
  });

  it("lehnt ein Nicht-Canvas ab", () => {
    expect(() => new SceneManager({} as HTMLCanvasElement, options)).toThrow(TypeError);
  });

  it("meldet 0 Draw-Calls vor dem ersten Render", () => {
    const manager = new SceneManager(makeCanvas(), options);
    expect(manager.getStats().drawCalls).toBe(0);
    expect(manager.getStats().triangles).toBe(0);
    manager.dispose();
  });

  it("rechnet den Radius je Koerper im aktuellen Modus", () => {
    const manager = new SceneManager(makeCanvas(), options);
    expect(manager.getBodyRadius("sonne")).toBeCloseTo(6.0, 5);
    expect(manager.getBodyRadius("gibt-es-nicht")).toBeNull();
    manager.dispose();
  });

  it("setzt die Zeit und wirft bei ungueltigen Werten", () => {
    const manager = new SceneManager(makeCanvas(), options);
    expect(() => manager.setTime(Number.NaN)).toThrow(RangeError);
    manager.setTime(2460000.5);
    expect(manager.getJulianDate()).toBe(2460000.5);
    manager.dispose();
  });

  it("setzt die Kamera auf einen Koerper", () => {
    const manager = new SceneManager(makeCanvas(), options);
    manager.setTime(2451545.0);
    expect(() => manager.focusOn("erde")).not.toThrow();
    expect(() => manager.focusOn("unbekannt")).toThrow(RangeError);
    expect(() => manager.focusOn("erde", 0)).toThrow(RangeError);
    manager.dispose();
  });

  it("ueberspringt den Moduswechsel, wenn sich nichts aendert", () => {
    const manager = new SceneManager(makeCanvas(), options);
    expect(() => manager.setScaleMode("visual")).not.toThrow();
    expect(() => manager.setDistanceMode("visual")).not.toThrow();
    expect(() => manager.setScaleMode("real")).not.toThrow();
    expect(() => manager.setDistanceMode("log")).not.toThrow();
    manager.dispose();
  });

  it("ist beim Dispose idempotent", () => {
    const manager = new SceneManager(makeCanvas(), options);
    manager.dispose();
    expect(() => manager.dispose()).not.toThrow();
  });

  it("gibt den J2000-Bezug zurueck", () => {
    expect(SceneManager.getEpochJulianDate()).toBe(2451545.0);
    expect(SceneManager.getEpochUnixMs()).toBe(946728000000);
  });
});
