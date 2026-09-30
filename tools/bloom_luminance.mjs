// Berechnet die Luminanz (Rec.709, so wie three sie im
// LuminosityHighPassShader verwendet) fuer die Sonne, ihre Gluehhaelle
// und die Planetenfarben — als Grundlage fuer die Bloom-Schwelle in Ticket 18.
//
// WICHTIG: UnrealBloomPass setzt smoothWidth = 0.01 (UnrealBloomPass.js:137),
// NICHT den Default 1.0 des Shaders. Die Schwelle ist damit praktisch
// binaer: L >= threshold + 0.01 -> alpha 1, L < threshold -> alpha 0.
// Der Uebergangsbereich ist 0.01 breit, nicht 1.0.
//
// Aufruf: node tools/bloom_luminance.mjs
import { readFileSync } from 'node:fs';
import { Color } from 'three';

const bodies = JSON.parse(readFileSync('src/data/bodies.json', 'utf8'));
const list = Array.isArray(bodies) ? bodies : (bodies.bodies ?? bodies.items ?? []);

/** Luminanz eines three-Colors, so wie LuminosityHighPassShader sie berechnet. */
function lum(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Farbe eines Hex-Werts inkl. Farbmanagement (sRGB -> linear). */
function lin(hex) {
  return new Color().setStyle(`#${hex.toString(16).padStart(6, '0')}`, 'srgb');
}

/** smoothstep(e0, e1, x) mit 0 <= x <= 1 (GLSL-Semantik). */
function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const SUN_COLOR = 0xffb000;
const GLOW_COLOR = 0xff8a1a;
const GLOW_OPACITY = 0.28;
const SMOOTH_WIDTH = 0.01;

const sunL = lum(lin(SUN_COLOR));
const glowL = lum(lin(GLOW_COLOR)) * GLOW_OPACITY;

console.log('=== Sonderfarben (Quelle: src/scene/BodyFactory.ts)');
const sun = lin(SUN_COLOR);
console.log(`  Sonne       #${SUN_COLOR.toString(16)}  linear=(${sun.r.toFixed(3)}, ${sun.g.toFixed(3)}, ${sun.b.toFixed(3)})  L=${sunL.toFixed(3)}`);
const glow = lin(GLOW_COLOR);
console.log(`  Gluehhaelle #${GLOW_COLOR.toString(16)}  linear=(${glow.r.toFixed(3)}, ${glow.g.toFixed(3)}, ${glow.b.toFixed(3)})  L=${lum(glow).toFixed(3)} x${GLOW_OPACITY} = ${glowL.toFixed(3)}`);

console.log('\n=== Planeten/Monde: Albedo-Luminanz (color aus bodies.json)');
const rows = list
  .filter((b) => b.type === 'planet' || b.type === 'star')
  .map((b) => ({ id: b.id, l: lum(new Color().setStyle(b.color, 'srgb')) }))
  .sort((a, b) => b.l - a.l);
for (const r of rows) console.log(`  ${r.id.padEnd(10)} L=${r.l.toFixed(3)}`);

const planets = rows.filter((r) => r.id !== 'sonne' && r.id !== 'sun');
const brightest = planets[0];
const brightestLit = brightest.l * 1.6 / Math.PI; // HemisphereLight 1.6 * Lambert / PI
console.log(`\n  hellster Planet: ${brightest.id}  Albedo-L=${brightest.l.toFixed(3)}`);
console.log(`    mit HemisphereLight 1.6 (Lambert/PI): L~${brightestLit.toFixed(3)}`);

console.log(`\n=== Bloom-Alpha = smoothstep(th, th+${SMOOTH_WIDTH}, L)`);
console.log('  (Sonne unveraendert, L=' + sunL.toFixed(3) + ')');
for (const th of [0.85, 0.7, 0.55, 0.5, 0.4, 0.3]) {
  const a = smoothstep(th, th + SMOOTH_WIDTH, sunL);
  const pa = smoothstep(th, th + SMOOTH_WIDTH, brightestLit);
  console.log(`  threshold=${th.toFixed(2)}  Sonne -> ${a.toFixed(4)}   hellster Planet (L~${brightestLit.toFixed(2)}) -> ${pa.toFixed(4)}`);
}

console.log('\n=== Wie hoch muss die Sonne ueber threshold gehoben werden?');
for (const mult of [1.5, 2.0, 2.5, 3.0, 4.0]) {
  const l = sunL * mult;
  const row = [0.3, 0.55, 0.85, 1.0]
    .map((th) => `th=${th.toFixed(2)}:${smoothstep(th, th + SMOOTH_WIDTH, l).toFixed(2)}`)
    .join('  ');
  console.log(`  Sonne x${mult.toFixed(1)}  L=${l.toFixed(3)}   ${row}`);
}
console.log('\n  Empfehlung: Sonne auf L >= threshold + 0.01 bringen, dann threshold');
console.log('  ueber der hellsten Planetenluminanz halten (Planeten duerfen nicht blueten).');
console.log(`  Realistisch: Sonne x2.5-x3, threshold 0.55-0.85, Planeten-Notfallschwelle ${brightestLit.toFixed(2)}+.`);
