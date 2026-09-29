import { orbitalPosition } from "../src/core/orbital";
import * as fs from "node:fs";

interface BodyLike {
  id: string;
  parent: string | null;
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  rotationPeriodH: number;
}

const raw = fs.readFileSync("src/data/bodies.json", "utf8");
const all = JSON.parse(raw).bodies as BodyLike[];
// Sonne hat semiMajorAxisKm = 0 und wird im Renderer uebersprungen.
const bodies = all.filter((b) => b.type !== undefined && b.semiMajorAxisKm > 0);

const FRAMES = 60;
const t0 = process.hrtime.bigint();
for (let f = 0; f < FRAMES; f += 1) {
  for (const b of bodies) orbitalPosition(b, 2460000.5 + f);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(
  `${bodies.length} Koerper x ${FRAMES} Frames: ${ms.toFixed(1)} ms ` +
    `-> ${(ms / FRAMES).toFixed(2)} ms/Frame`,
);
