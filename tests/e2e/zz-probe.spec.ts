/** Temporaere Probe — wird nach dem Lauf geloescht. */
import { test } from "@playwright/test";
import type { Page } from "@playwright/test";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EPOCH = 2451545;
const FOCUS_FACTOR = 2.6;

async function shot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 800 } });
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function approach(page: Page, query: string, bodyId: string): Promise<string> {
  await page.goto(`/${query}`);
  await page.waitForFunction(
    () => (window as unknown as Record<string, unknown>)["__solarExplorer"] !== undefined,
    undefined,
    { timeout: 20_000 },
  );
  if (!query.includes("textures=off")) {
    await page.waitForFunction(
      () => {
        const hook = (window as unknown as Record<string, unknown>)[
          "__solarExplorer"
        ] as { getStats: () => { textured: number } } | undefined;
        return hook !== undefined && hook.getStats().textured >= 15;
      },
      undefined,
      { timeout: 30_000 },
    );
  }
  await page.evaluate(
    ({ id, epoch, factor }) => {
      const hook = (window as unknown as Record<string, unknown>)[
        "__solarExplorer"
      ] as {
        setPaused: (v: boolean) => void;
        setEpoch: (d: number) => void;
        focusBodyInstant: (i: string, f?: number) => void;
        bodyScreenRect: (i: string, m?: number) => Box | null;
      };
      hook.setPaused(true);
      hook.setEpoch(epoch);
      hook.focusBodyInstant(id, factor);
      const rect = hook.bodyScreenRect(id, 0.1);
      if (rect !== null) {
        (window as unknown as Record<string, unknown>)["__probeBox"] = rect;
      }
    },
    { id: bodyId, epoch: EPOCH, factor: FOCUS_FACTOR },
  );
  await page.waitForTimeout(300);
  return shot(page);
}

async function boxOf(page: Page): Promise<Box> {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>)["__probeBox"] as Box,
  );
}

async function measure(
  page: Page,
  a: string,
  b: string,
  tolerance: number,
  region: Box,
): Promise<{
  changed: number;
  total: number;
  meanDelta: number;
  absMean: number;
  absMeanB: number;
}> {
  return page.evaluate(
    async ([urlA, urlB, limit, clip]) => {
      const load = async (url: string): Promise<HTMLImageElement> => {
        const image = new Image();
        image.src = url as string;
        await image.decode();
        return image;
      };
      const [imgA, imgB] = await Promise.all([load(urlA as string), load(urlB as string)]);
      const box = clip as Box;
      const scratch = document.createElement("canvas");
      scratch.width = box.width;
      scratch.height = box.height;
      const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(imgA, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      const before = ctx.getImageData(0, 0, box.width, box.height).data;
      ctx.clearRect(0, 0, box.width, box.height);
      ctx.drawImage(imgB, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
      const after = ctx.getImageData(0, 0, box.width, box.height).data;
      const lum = (d: Uint8ClampedArray, i: number): number =>
        0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
      // Kanal-Differenz statt Luminanz: die Erde ist ueberwiegend dunkles
      // Meer, ihre Textur aendert die Luminanz kaum, die Farbe aber deutlich
      // (Meer hellblau gegen Land ocker). Mit reiner Luminanz gemessen lag die
      // A/B-Aenderung dort bei 0.5 %, mit Kanaldifferenz ist sie wesentlich
      // groesser.
      const chan = (d: Uint8ClampedArray, o: Uint8ClampedArray, i: number): number =>
        Math.max(
          Math.abs((d[i] ?? 0) - (o[i] ?? 0)),
          Math.abs((d[i + 1] ?? 0) - (o[i + 1] ?? 0)),
          Math.abs((d[i + 2] ?? 0) - (o[i + 2] ?? 0)),
        );
      const threshold = limit as number;
      let changed = 0;
      let sumDelta = 0;
      let sumAbs = 0;
      let sumAbsB = 0;
      const total = before.length / 4;
      for (let i = 0; i < before.length; i += 4) {
        const d = chan(before, after, i);
        sumDelta += d;
        sumAbs += lum(before, i);
        sumAbsB += lum(after, i);
        if (d > threshold) changed += 1;
      }
      return {
        changed,
        total,
        meanDelta: sumDelta / total,
        absMean: sumAbs / total,
        absMeanB: sumAbsB / total,
      };
    },
    [a, b, tolerance, region] as const,
  );
}

test("probe: A/B-Messwerte je Planet", async ({ page }) => {
  test.setTimeout(300_000);
  for (const id of [
    "merkur",
    "venus",
    "erde",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptun",
  ]) {
    const plain = await approach(page, "?textures=off", id);
    const box = await boxOf(page);
    const plainAgain = await approach(page, "?textures=off", id);
    const textured = await approach(page, "", id);
    for (const tol of [3, 12]) {
      const ab = await measure(page, plain, textured, tol, box);
      const ctl = await measure(page, plain, plainAgain, tol, box);
      // eslint-disable-next-line no-console
      console.log(
        `${id.padEnd(8)} tol=${String(tol).padStart(2)} box=${String(box.width).padStart(4)}` +
          `@${String(box.x).padStart(5)} ` +
          `A/B ${(100 * ab.changed / ab.total).toFixed(1).padStart(5)} % ` +
          `meanD=${ab.meanDelta.toFixed(2).padStart(5)} | ` +
          `CTL ${(100 * ctl.changed / ctl.total).toFixed(2).padStart(5)} % ` +
          `meanD=${ctl.meanDelta.toFixed(2)} | ` +
          `lum ${ab.absMean.toFixed(1)}->${ab.absMeanB.toFixed(1)}`,
      );
    }
  }
});
