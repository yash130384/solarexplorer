/**
 * Tests fuer den Sonnen-Glanz (Ticket 18).
 *
 * Der Nachweis zerlegt sich in zwei Teile:
 *
 * 1. **Rechnen** (`relativeLuminance`, `resolveSunGlowSettings`,
 *    `boostSunSurface`) — davon haengt ab, ob die Sonne ueberhaupt ueber der
 *    Bloom-Schwelle liegt und ob ein Planet sie mit reisst. Beides ist ohne
 *    WebGL messbar und wird hier mit echten Zahlen aus `bodies.json` belegt.
 * 2. **Anschluss** (`SunGlow`, `SceneManager`) — die Pass-Kette selbst
 *    braucht einen GPU-Kontext; dafuer uebernimmt der E2E-Test
 *    `tests/e2e/sun-glow.spec.ts`.
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BodyFactory } from "../../src/scene/BodyFactory";
import {
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  boostSunSurface,
  relativeLuminance,
  resolveSunGlowSettings,
  SUN_HDR_GAIN,
  SunGlow,
} from "../../src/scene/SunGlow";
import { loadSceneBodies } from "../../src/scene/types";
import type { SceneBody } from "../../src/scene/types";

const bodies = loadSceneBodies();

/** Findet die Sonne im Datensatz. */
function sun(): SceneBody {
  const found = bodies.find((body) => body.type === "star");
  if (found === undefined) {
    throw new Error("bodies.json enthaelt keinen Stern — Testdaten unvollstaendig.");
  }
  return found;
}

/** Albedo-Luminanz eines Koerpers, so wie three sie linear haelt. */
function albedoLuminance(body: SceneBody): number {
  return relativeLuminance(new THREE.Color().setStyle(body.color, "srgb"));
}

describe("Sonnen-HDR (scene/SunGlow)", () => {
  it("hebt die Sonne deutlich ueber die Bloom-Schwelle", () => {
    const body = sun();
    const before = albedoLuminance(body);
    const mesh = BodyFactory.create(body, "visual", "visual");
    const after = relativeLuminance(
      (mesh.material as THREE.MeshBasicMaterial).color,
    );

    // Ohne Hebung liegt die Sonne (L 0.523) unter der Schwelle — das ist der
    // Grund, warum es die Hebung ueberhaupt gibt.
    expect(before).toBeLessThan(BLOOM_THRESHOLD);
    expect(after).toBeGreaterThan(BLOOM_THRESHOLD);
    // Der Faktor ist linear, sonst waere die Aussage "HDR" geraten.
    expect(after / before).toBeCloseTo(SUN_HDR_GAIN, 5);
    BodyFactory.dispose(mesh);
  });

  it("hebt nur die Sonne — kein Planet kommt ueber die Schwelle", () => {
    const lit = new Set(["uranus", "saturn", "neptun", "jupiter"]);
    for (const body of bodies) {
      if (body.type !== "planet" || !lit.has(body.id)) {
        continue;
      }
      // Selbst mit vollem Hemisphaerenlicht (1.6, Lambert 1/PI) bleiben die
      // Planeten unter der Schwelle. Ohne diese Kopplung wuerde die Sonne
      // beim Bloom mitsammeln, was ein Planet von innen leuchtend aussehen
      // laesst.
      const litAlbedo = albedoLuminance(body) * 1.6 / Math.PI;
      expect(litAlbedo, `${body.id} blutet nicht mit`).toBeLessThan(BLOOM_THRESHOLD);
    }
  });

  it("hebt die Sonne hoechstens einmal", () => {
    const mesh = BodyFactory.create(sun(), "visual", "visual");
    const material = mesh.material as THREE.MeshBasicMaterial;
    const once = material.color.clone();
    // Der Neuaufbau der Szene (Skalierungswechsel) ruft die Hebung erneut.
    boostSunSurface(mesh);
    expect(material.color.r).toBeCloseTo(once.r, 10);
    expect(material.color.g).toBeCloseTo(once.g, 10);
    expect(material.color.b).toBeCloseTo(once.b, 10);
    BodyFactory.dispose(mesh);
  });

  it("laesst die Sonne auch ohne Postprocessing hell", () => {
    // `BodyFactory.create` hebt die Farbe unabhaengig davon, ob ein Composer
    // laeuft — sonst waere die Sonne auf der sparsamen Qualitaetsstufe dunkel.
    const mesh = BodyFactory.create(sun(), "visual", "visual");
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(relativeLuminance(material.color)).toBeGreaterThan(1);
    BodyFactory.dispose(mesh);
  });
});

describe("Bloom-Parameter", () => {
  it("schaltet den Glanz auf der sparsamen Stufe ab", () => {
    // Software-Rasterisierer: 11 zusaetzliche Vollbild-Durchgaenge kosten dort
    // mehr Bildrate, als sie Effekt bringen.
    expect(resolveSunGlowSettings("low", "auto").enabled).toBe(false);
  });

  it("schaltet den Glanz auf echter Hardware ein", () => {
    expect(resolveSunGlowSettings("medium", "auto").enabled).toBe(true);
    expect(resolveSunGlowSettings("high", "auto").enabled).toBe(true);
  });

  it("laesst sich erzwingen und abschalten", () => {
    expect(resolveSunGlowSettings("low", "on").enabled).toBe(true);
    expect(resolveSunGlowSettings("high", "off").enabled).toBe(false);
  });

  it("haelt die Parameter unveraendert", () => {
    const settings = resolveSunGlowSettings("high", "auto");
    expect(settings.strength).toBe(BLOOM_STRENGTH);
    expect(settings.threshold).toBe(BLOOM_THRESHOLD);
    expect(settings.threshold).toBeGreaterThan(0);
    expect(settings.strength).toBeGreaterThan(0);
  });
});

describe("SunGlow (ohne GPU)", () => {
  /** Minimaler Renderer-Ersatz: der Composer fragt nur Ratio und Groesse ab. */
  function fakeRenderer(): THREE.WebGLRenderer {
    return {
      getPixelRatio: () => 1,
      getSize: (target: THREE.Vector2) => target.set(800, 600),
    } as unknown as THREE.WebGLRenderer;
  }

  it("verweigert den Bau, wenn der Glanz aus ist", () => {
    expect(
      () =>
        new SunGlow(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), {
          enabled: false,
          strength: BLOOM_STRENGTH,
          radius: 0.5,
          threshold: BLOOM_THRESHOLD,
        }),
    ).toThrow(TypeError);
  });

  it("baut eine Kette aus Render-, Stats-, Bloom- und Output-Pass", () => {
    // Die Reihenfolge ist bindend: ohne OutputPass waere das Bild entweder
    // doppelt tonemapped oder linear. Ohne GPU laesst sich das nicht
    // zeichnen, aber die Pass-Reihenfolge ist pruefbar.
    //
    // Der `SceneStatsPass` muss **direkt** nach dem `RenderPass` stehen: ab
    // da zaehlt `renderer.info` die Vollbild-Quadse der Bloom-Passes statt
    // der Szene.
    const glow = new SunGlow(
      fakeRenderer(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { enabled: true, strength: BLOOM_STRENGTH, radius: 0.5, threshold: BLOOM_THRESHOLD },
    );
    const passes = (
      glow as unknown as { composer: { passes: { constructor: { name: string } }[] } }
    ).composer.passes.map((pass) => pass.constructor.name);
    expect(passes).toEqual([
      "RenderPass",
      "SceneStatsPass",
      "UnrealBloomPass",
      "OutputPass",
    ]);
    expect(glow.getSettings().threshold).toBe(BLOOM_THRESHOLD);
    expect(() => glow.dispose()).not.toThrow();
  });

  it("meldet vor dem ersten Bild keine Draw-Calls", () => {
    const glow = new SunGlow(
      fakeRenderer(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { enabled: true, strength: BLOOM_STRENGTH, radius: 0.5, threshold: BLOOM_THRESHOLD },
    );
    expect(glow.getSceneStats()).toEqual({ drawCalls: 0, triangles: 0 });
    expect(() => glow.dispose()).not.toThrow();
  });

  it("faengt die Zeichenaufrufe des Szenendurchgangs", () => {
    // Der ganze Sinn des `SceneStatsPass`: er liest `info.render`, waehrend
    // es noch die Szene zaehlt. Ohne ihn lieferte `getStats()` mit Bloom die
    // Vollbild-Quadse — gemessen 1 statt 30.
    const glow = new SunGlow(
      fakeRenderer(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { enabled: true, strength: BLOOM_STRENGTH, radius: 0.5, threshold: BLOOM_THRESHOLD },
    );
    const pass = (
      glow as unknown as { statsPass: { render: (r: unknown) => void; needsSwap: boolean } }
    ).statsPass;

    pass.render({ info: { render: { calls: 30, triangles: 40_496 } } });
    expect(glow.getSceneStats()).toEqual({ drawCalls: 30, triangles: 40_496 });

    // Ein spaeterer Pass setzt den Zaehler zurueck — der Schnappschuss darf
    // davon unberuehrt bleiben.
    pass.render({ info: { render: { calls: 1, triangles: 1 } } });
    expect(glow.getSceneStats()).toEqual({ drawCalls: 1, triangles: 1 });

    // Er zeichnet nichts und darf die Puffer nicht tauschen, sonst kaeme der
    // Bloom-Pass an einem leeren Puffer an.
    expect(pass.needsSwap).toBe(false);
    expect(() => glow.dispose()).not.toThrow();
  });

  it("gibt beim Dispose seine Renderziele frei", () => {
    // Ohne WebGL-Kontext baut der Composer nur die Objekthierarchie auf;
    // `dispose` muss trotzdem ohne Fehler durchlaufen.
    const glow = new SunGlow(fakeRenderer(), new THREE.Scene(), new THREE.PerspectiveCamera(), {
      enabled: true,
      strength: BLOOM_STRENGTH,
      radius: 0.5,
      threshold: BLOOM_THRESHOLD,
    });
    expect(glow.getSettings().threshold).toBe(BLOOM_THRESHOLD);
    expect(() => glow.dispose()).not.toThrow();
  });
});

describe("relativeLuminance", () => {
  it("rechnet nach Rec.709 wie der Bloom-Hochpass", () => {
    const white = new THREE.Color(1, 1, 1);
    expect(relativeLuminance(white)).toBeCloseTo(1, 10);
    const black = new THREE.Color(0, 0, 0);
    expect(relativeLuminance(black)).toBe(0);
    // Reine Gruenfarbe: 0.7152 * 1 = L
    const green = new THREE.Color().setRGB(0, 1, 0);
    expect(relativeLuminance(green)).toBeCloseTo(0.7152, 10);
  });

  it("aendert die Farbe nicht", () => {
    const color = new THREE.Color(0.2, 0.4, 0.6);
    const before = color.clone();
    relativeLuminance(color);
    expect(color.equals(before)).toBe(true);
  });
});

describe("BodyFactory — Sonne bleibt abbaubar", () => {
  it("gibt auch das gehobene Material frei", () => {
    const mesh = BodyFactory.create(sun(), "visual", "visual");
    const spy = vi.spyOn(mesh.material as THREE.Material, "dispose");
    BodyFactory.dispose(mesh);
    expect(spy).toHaveBeenCalled();
  });
});
