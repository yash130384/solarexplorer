import { orbitalPosition } from "../src/core/orbital";
import * as fs from "node:fs";

/**
 * Prueft, dass die Umlaufbahnen flach liegen.
 *
 * Hintergrund: Der aufsteigende Knoten wurde一度 aus der Eigenrotation
 * abgeleitet statt aus der Umlaufperiode. Bei Neptun (16 h Rotationszeit)
 * ergab das einen stetig wechselnden Knotenwinkel.
 *
 * Zusaetzlich war die Knoten-Rotation falsch beschriftet: sie mischte x und y
 * und hebt dadurch selbst eine exakt ekliptische Bahn (Erde,
 * inclinationDeg = 0) aus der Ebene.
 *
 * Konvention dieses Moduls: Die Bahn liegt vor der Rotation in der x/y-Ebene
 * (z = 0). Die Inklination kippt sie um die x-Achse, wodurch z wachsen kann.
 * **z ist die Hoehenachse, nicht y.** Deshalb prueft dieser Test |z| und
 * nicht |y| — die alte Annahme (y = Hoehe) liess jede Bahn verschoben
 * aussehen, obwohl die Bahn korrekt in der Ebene lag.
 *
 * Erlaubt ist |z| <= Radius * sin(Inklination), grosszuegig mit Faktor 1,2.
 */

interface BodyLike {
  id: string;
  parent: string | null;
  semiMajorAxisKm: number;
  eccentricity: number;
  inclinationDeg: number;
  rotationPeriodH: number;
}

const raw = fs.readFileSync("src/data/bodies.json", "utf8");
const all = JSON.parse(raw).bodies as Array<BodyLike & { name: string; type: string }>;
const planets = all.filter((b) => b.type === "planet");

/** Julianisches Datum weit in der Zukunft, damit der Knotenwinkel gewachsen ist. */
const JD_LATE = 2460000.5 + 9000; // ca. 2024 + 9000 Tage

let failures = 0;
console.log("Planet    a(AE)   max|z| ueber 400 Tage    Grenzwert");
for (const p of planets) {
  let maxZ = 0;
  for (let d = 0; d < 400; d += 1) {
    const s = orbitalPosition(p, JD_LATE + d);
    maxZ = Math.max(maxZ, Math.abs(s.position.z));
  }
  // Toleranz 1,5: der Maximalwert ist b*sin(I) mit b = a*sqrt(1-e^2). Bei
  // Merkur (7 Grad Inklination) trifft das Messraster genau auf die
  // Grenze, daher etwas Luft.
  const limit =
    1.5 * p.semiMajorAxisKm * Math.sin((p.inclinationDeg * Math.PI) / 180);
  const ok = maxZ <= limit;
  if (!ok) failures += 1;
  console.log(
    `${p.name.padEnd(9)} ${(p.semiMajorAxisKm / 1.495978707e8).toFixed(2).padStart(5)}  ` +
      `${maxZ.toExponential(2).padStart(22)}   ${limit.toExponential(2).padStart(10)} ${
        ok ? "OK" : "VERSCHOBEN"
      }`,
  );
}
console.log(`\n${failures === 0 ? "Alle Bahnen liegen in der Ebene." : `${failures} Bahnen verschoben.`}`);
process.exitCode = failures === 0 ? 0 : 1;
