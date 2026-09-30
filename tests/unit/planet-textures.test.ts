/**
 * Nachweis fuer Ticket 19: die prozeduralen Texturen landen an den
 * Koerper-Materialien.
 *
 * Geprueft wird das ohne WebGL, weil der Nachweis an zwei Stellen haengt,
 * die der Objektgraph beantwortet: der Auswahl der Koerper-IDs
 * (`texturedBodyIds`) und dem Setzen von `map` in `BodyFactory`. Das
 * tatsaechliche Dekodieren der PNG und die Darstellung im Bild belegt
 * `tests/e2e/planet-textures.spec.ts` gegen das gebaute Bundle.
 *
 * `TextureLoader` wird dafuer gestubbt — in jsdom gibt es keinen
 * Bilddecoder, und genau der Pfad ist hier nicht das Thema. Die
 * Konfiguration der Textur (`configureTexture`) laeuft trotzdem mit, weil sie
 * an der geladenen Textur haengt und nicht am Loader.
 */

import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BodyFactory } from "../../src/scene/BodyFactory";
import { FEATURED_MOON_IDS } from "../../src/scene/InstancedMoons";
import {
  disposeTextures,
  getTexture,
  preloadTextures,
  texturedBodyIds,
  textureUrl,
} from "../../src/scene/textures";
import { loadSceneBodies } from "../../src/scene/types";

const bodies = loadSceneBodies();

/** Koerper aus bodies.json, oder `undefined` — nie `null`, fuer `!`. */
function body(id: string) {
  const found = bodies.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`Testkoerper fehlt in bodies.json: ${id}`);
  }
  return found;
}

/** Anzahl der Planeten plus benannten Monde — der Sollwert des Texturfilters. */
const EXPECTED_TEXTURED = 8 + FEATURED_MOON_IDS.size;

beforeEach(() => {
  vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockImplementation(
    async () => new THREE.Texture(),
  );
});

afterEach(() => {
  disposeTextures();
  vi.restoreAllMocks();
});

describe("Textur-Auswahl", () => {
  it("liefert genau die acht Planeten und die sieben benannten Monde", () => {
    const ids = texturedBodyIds(bodies);
    expect(ids).toHaveLength(EXPECTED_TEXTURED);
    expect(ids).toEqual(
      expect.arrayContaining([
        "merkur",
        "venus",
        "erde",
        "mars",
        "jupiter",
        "saturn",
        "uranus",
        "neptun",
        "mond",
        "io",
        "europa",
        "titan",
        "triton",
        "phobos",
        "deimos",
      ]),
    );
  });

  it("laesst die Sonne weg — sie bleibt einfarbig (siehe BodyFactory)", () => {
    expect(texturedBodyIds(bodies)).not.toContain("sonne");
  });

  it("fragt keinen der kleinen Monde ab", () => {
    // Ohne Whitelist waeren das ueber 400 ausschlagende Requests mit 404
    // und ebenso viele Konsolenfehler — der E2E-Lauf verlangt eine saubere
    // Konsole, und instanzierte Monde teilen sich ohnehin ein Material.
    const ids = texturedBodyIds(bodies);
    const instanced = bodies.filter(
      (entry) => entry.type === "moon" && !FEATURED_MOON_IDS.has(entry.id),
    );
    expect(instanced.length).toBeGreaterThan(400);
    for (const moon of instanced) {
      expect(ids).not.toContain(moon.id);
    }
  });

  it("normalisiert auf Kleinbuchstaben und entdoppelt", () => {
    const ids = texturedBodyIds([
      { id: " Erde ", type: "planet", color: "#000000" },
      { id: "erde", type: "planet", color: "#000000" },
    ]);
    expect(ids).toEqual(["erde"]);
  });

  it("baut einen stabilen, relativen Pfad ohne Hash", () => {
    expect(textureUrl("erde")).toBe("./media/textures/erde.png");
    expect(textureUrl("  ")).toBeNull();
  });
});

describe("Material mit Textur", () => {
  it("haengt die geladene Textur an das Standardmaterial", async () => {
    await preloadTextures(["erde"]);
    const material = BodyFactory.createMaterial(body("erde"));
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((material as THREE.MeshStandardMaterial).map).toBe(
      getTexture("erde"),
    );
  });

  it("setzt die Textur an genau 15 Koerper-Meshes", async () => {
    await preloadTextures(texturedBodyIds(bodies));
    let textured = 0;
    for (const entry of bodies) {
      const material = BodyFactory.createMaterial(entry);
      if (
        material instanceof THREE.MeshStandardMaterial &&
        material.map !== null
      ) {
        textured += 1;
      }
    }
    expect(textured).toBe(EXPECTED_TEXTURED);
  });

  it("laesst die Sonne einfarbig — ihre Farbe traegt den HDR-Gain", async () => {
    // Ein `map` auf dem `MeshBasicMaterial` wuerde die auf HDR gehobene
    // Farbe (L = 1.308) mit einem Mittel unter 1 multiplizieren und die
    // dunklen Sonnenflecken unter die Bloom-Schwelle druecken.
    await preloadTextures(["sonne"]);
    const material = BodyFactory.createMaterial(body("sonne"));
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((material as THREE.MeshBasicMaterial).map).toBeNull();
  });

  it("faellt ohne Textur auf die Farbe aus bodies.json zurueck", () => {
    // `preloadTextures` laeuft im Test nicht, der Cache ist also leer:
    // genau der Fall einer fehlenden Datei.
    const mars = body("mars");
    const material = BodyFactory.createMaterial(
      mars,
    ) as THREE.MeshStandardMaterial;
    expect(material.map).toBeNull();
    expect(material.color.getHexString()).toBe(
      new THREE.Color(mars.color).getHexString(),
    );
  });

  it("nutzt Rauheits- und Normalkarte, falls vorhanden", async () => {
    // Die prozedural erzeugten Texturen liefern jetzt auch
    // roughnessMap und normalMap (siehe generate_textures.py).
    await preloadTextures(["jupiter"]);
    const material = BodyFactory.createMaterial(
      body("jupiter"),
    ) as THREE.MeshStandardMaterial;
    expect(material.roughnessMap).not.toBeNull();
    expect(material.normalMap).not.toBeNull();
    expect(material.roughness).toBeCloseTo(0.9);
  });

  it("gibt dem Mesh dieselbe Textur wie die Fabrik", async () => {
    await preloadTextures(["saturn"]);
    const mesh = BodyFactory.create(body("saturn"), "visual", "visual");
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.map).toBe(getTexture("saturn"));
  });

  it("nutzt die Standard-UV-Koordinaten der LOD-Kugel (Equirectangular)", async () => {
    // Kein eigenes UV-Mapping: `SphereGeometry` liefert u = Laengengrad,
    // v = Breitengrad. Geprueft wird an der **geteilten** Geometrie, weil
    // genau sie von mehreren Koerpern benutzt wird und deshalb kein
    // koerperspezifisches UV-Schema bekommen kann.
    await preloadTextures(["jupiter"]);
    const mesh = BodyFactory.create(body("jupiter"), "visual", "visual");
    const uv = mesh.geometry.getAttribute("uv");
    expect(uv).toBeDefined();
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < uv.count; i += 1) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    // Die Kugel deckt die volle Kachel ab — genau das erwartet eine 2:1-
    // Equirectangular-Karte. Nur die exakten Polpunkte erreichen v = 0/1.
    expect(minU).toBeLessThanOrEqual(0.001);
    expect(maxU).toBeGreaterThanOrEqual(0.999);
    expect(minV).toBeCloseTo(0, 5);
    expect(maxV).toBeCloseTo(1, 5);
  });
});

describe("Textur-Konfiguration und Fehlertoleranz", () => {
  it("setzt sRGB, Repeat in u und Clamp in v", async () => {
    // Repeat in u schliesst die Equirectangular-Naht bei 0/360 Grad;
    // Clamp in v verhindert das Umlaufen an den Polen.
    await preloadTextures(["mars"]);
    const texture = getTexture("mars");
    expect(texture).not.toBeNull();
    expect(texture?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture?.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture?.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("behandelt eine fehlende Datei als 404 und startet trotzdem", async () => {
    // Ohne `.catch` wuerfe `Promise.all` bei der ersten nicht
    // vorhandenen Textur und der komplette Szenenaufbau bricht ab.
    vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockRejectedValue(
      new Error("404"),
    );
    await expect(
      preloadTextures(texturedBodyIds(bodies)),
    ).resolves.toBeUndefined();
    expect(getTexture("erde")).toBeNull();
  });

  it("laedt jede Textur nur einmal", async () => {
    // Farb-, Rauheits- und Normal-Textur werden je Koerper geladen;
    // nach dispose + erneuter Anforderung wird jede erneut geladen,
    // der dritte Aufruf findet alles im Cache.
    const load = vi.mocked(THREE.TextureLoader.prototype.loadAsync);
    await preloadTextures(["erde"]);
    expect(load).toHaveBeenCalledTimes(3);
    disposeTextures();
    await preloadTextures(["erde"]);
    expect(load).toHaveBeenCalledTimes(6);
    await preloadTextures(["erde"]);
    expect(load).toHaveBeenCalledTimes(6);
  });
});
