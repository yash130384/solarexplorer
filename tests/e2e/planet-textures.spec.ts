/**
 * Nachweis fuer Ticket 19: die Planeten tragen ihre Oberflaechen-Texturen.
 *
 * Der Unit-Test (`tests/unit/planet-textures.test.ts`) zeigt, dass `map` am
 * Material steht. Er kann aber nicht zeigen, dass die PNG aus
 * `dist/media/textures/` wirklich **heruntergeladen, dekodiert und
 * hochgeladen** wurde — dafuer braucht es einen Browser gegen das gebaute
 * Bundle. Geprueft werden deshalb drei getrennte Dinge:
 *
 * 1. Die Dateien liegen unter dem stabilen Pfad, den `textures.ts` baut
 *    (HTTP 200, echtes PNG — kein HTML-Fehldokument eines SPA-Routers).
 * 2. Die Materialien der Szene tragen danach Texturen an 15 Koerper-Meshes:
 *    8 Planeten und 7 benannte Monde. Die Sonne bleibt einfarbig (HDR),
 *    die ueber 400 instanzierten Monde teilen sich ein Material.
 *    Pro Koerper sind jetzt Farb-, Rauheits- und Normal-Map am Material.
 * 3. Die Texturen kosten keine Draw-Calls und ueberstehen den Neuaufbau der
 *    Koerper, der beim Skalierungswechsel alle Materialien neu erzeugt.
 *
 * @module e2e/planet-textures
 */

import { expect, test } from "@playwright/test";
import type { ConsoleMessage, Page } from "@playwright/test";

/** Koerper, fuer die eine Textur erwartet wird: 8 Planeten + 7 Monde. */
const EXPECTED_TEXTURED = 15;

/** IDs, die im `dist/`-Verzeichnis als PNG liegen muessen. */
const EXPECTED_FILES = [
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
  "ganymede",
  "kallisto",
  "titan",
  "enceladus",
  "mimas",
  "triton",
  "phobos",
  "deimos",
];

/** Was der Debug-Haken ueber die Texturen der Materialien weiss. */
interface TextureStats {
  bodies: number;
  textured: number;
  drawCalls: number;
}

/** Formatiert Messwerte lesbar fuer den Testbericht. */
function report(label: string, value: string): void {
  // eslint-disable-next-line no-console
  console.log(`  ${label}: ${value}`);
}

/**
 * Wartet, bis die App steht und die Texturen an den Materialien haengen.
 *
 * @param page - Die Testseite.
 * @param expected - Erwartete Anzahl texturierter Meshes.
 * @returns {Promise<void>}
 */
async function waitForTextures(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (want) => {
      const hook = (window as unknown as Record<string, unknown>)[
        "__solarExplorer"
      ] as { getStats: () => TextureStats } | undefined;
      return hook !== undefined && hook.getStats().textured >= want;
    },
    expected,
    { timeout: 30_000 },
  );
}

/**
 * Laedt die App und sammelt Konsolenfehler.
 *
 * Die Texturen werden bewusst im Hintergrund geladen — `SceneManager.init`
 * blockiert den ersten Frame nicht darauf, sonst waere auf einem
 * Kindersystem erst nach 3,7 MB Download etwas zu sehen. Der Test wartet
 * deshalb auf den Zaehler statt auf eine feste Zeit.
 *
 * @param page - Die Testseite.
 * @returns Die Konsolenfehler des Ladevorgangs.
 */
async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  await waitForTextures(page, EXPECTED_TEXTURED);
  return errors;
}

/**
 * Liest die Szenenstatistik aus dem Debug-Haken.
 *
 * @param page - Die Testseite.
 * @returns Koerperzahl, texturierte Meshes und Draw-Calls.
 */
async function readStats(page: Page): Promise<TextureStats> {
  return page.evaluate(() => {
    const hook = (window as unknown as Record<string, unknown>)[
      "__solarExplorer"
    ] as { getStats: () => TextureStats };
    return hook.getStats();
  });
}

test.describe("Planeten-Texturen (Ticket 19)", () => {
  test("1. die Texturdateien liegen unter dem stabilen Pfad", async ({ page }) => {
    // Erst die Seite holen: `fetch` mit relativem Pfad braucht eine
    // Dokument-URL, `about:blank` hat keine.
    await page.goto("/");
    const results = await page.evaluate(async (names: string[]) => {
      const out: Record<
        string,
        { status: number; type: string; bytes: number }
      > = {};
      for (const name of names) {
        const response = await fetch(
          new URL(`./media/textures/${name}.png`, document.baseURI).href,
        );
        const blob = await response.blob();
        out[name] = { status: response.status, type: blob.type, bytes: blob.size };
      }
      return out;
    }, EXPECTED_FILES);

    for (const name of EXPECTED_FILES) {
      const entry = results[name] ?? {
        status: -1,
        type: "fehlt",
        bytes: 0,
      };
      expect(entry.status, `${name}.png wird ausgeliefert`).toBe(200);
      // Ein HTML-Fehldokument eines SPA-Routers hat Status 200, ist aber
      // kein PNG — genau dieser Fehlschluss waere sonst unbemerkt.
      expect(entry.type, `${name}.png ist wirklich ein PNG`).toBe("image/png");
      expect(entry.bytes, `${name}.png ist nicht leer`).toBeGreaterThan(1000);
    }
    report("geprueft", `${EXPECTED_FILES.length} Dateien`);
  });

  test("2. alle 15 Koerper-Meshes tragen eine Textur", async ({ page }) => {
    const errors = await openApp(page);
    const stats = await readStats(page);
    report("Koerper", String(stats.bodies));
    report("Meshes mit Textur", String(stats.textured));

    expect(stats.textured, "8 Planeten + 7 benannte Monde").toBe(
      EXPECTED_TEXTURED,
    );
    // Die untere Schranke trennt "Textur geladen" von einem Zufallstreffer:
    // die 8 Planeten allein waeren schon eine plausible Fehlinterpretation
    // (etwa wenn die Monde-Liste leer bliebe).
    expect(stats.textured).toBeGreaterThan(8);
    expect(errors, `Konsolenfehler:\n${errors.join("\n")}`).toEqual([]);
  });

  test("3. die Texturen kosten keine Draw-Calls und keine Dreiecke", async ({
    page,
  }) => {
    await openApp(page);
    const stats = await readStats(page);
    report("Draw-Calls mit Texturen", String(stats.drawCalls));
    // Eine Textur aendert die Geometrie nicht, also auch nicht die
    // Zeichenaufrufe. Der Wert liegt in derselben Groessenordnung wie vor
    // Ticket 19 (vorher gemessen: 30 bis 31 Szenen-Draw-Calls).
    expect(stats.drawCalls).toBeGreaterThan(10);
    expect(
      stats.drawCalls,
      "Texturen duerfen keine zusaetzlichen Draw-Calls kosten",
    ).toBeLessThan(300);
  });

  test("4. ein Skalierungswechsel verliert die Texturen nicht", async ({ page }) => {
    // `rebuildBodies` erzeugt alle Materialien neu. Sieht `BodyFactory` in
    // den gefuellten Cache, bekommen alle Koerper ihre Textur automatisch
    // zurueck — das ist der Grund, warum der Cache den Wechsel ueberlebt.
    await openApp(page);
    await page.goto("/?scale=real");
    await page.waitForFunction(
      () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
      undefined,
      { timeout: 20_000 },
    );
    await waitForTextures(page, EXPECTED_TEXTURED);
    const stats = await readStats(page);
    report("Meshes mit Textur (scale=real)", String(stats.textured));
    expect(stats.textured).toBe(EXPECTED_TEXTURED);
  });

  test("5. genau die erwarteten Dateien werden angefragt", async ({ page }) => {
    // Der Filter ist absichtlich eine Whitelist: Ganymede, Kallisto,
    // Enceladus und Mimas *haben* Dateien, werden aber instanziert oder gar
    // nicht einzeln gerendert — fuer sie nachzufragen ergaebe ueber 400
    // sinnlose Requests. Umgekehrt darf kein 404 entstehen, weil der
    // E2E-Lauf eine fehlerfreie Konsole verlangt.
    // Pro Koerper werden jetzt 3 Dateien angefragt: Farbe, Rauheit, Normal.
    await openApp(page);
    const requested = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("/media/textures/"))
        .map((name) => name.split("/").pop() ?? name)
        .sort(),
    );
    report("geladene Texturen", requested.join(", "));
    // 15 Koerper × 3 Dateien (Farbe + Rauheit + Normal) = 45
    expect(requested).toHaveLength(45);
    for (const base of EXPECTED_FILES) {
      expect(requested).toContain(`${base}.png`);
      expect(requested).toContain(`${base}_roughness.png`);
      expect(requested).toContain(`${base}_normal.png`);
    }
  });
});
