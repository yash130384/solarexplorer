// Prueft die CC0-Assets in public/media/models/ und public/media/audio/:
//   - GLB: parsebar, Dreieckszahl, Materialien, KEINE eingebetteten Bilder
//     (sonst waere das Repo nicht mehr texturlos / haette Bild-Downloads)
//   - GLB: Bounding-Box plausibel (nicht leer)
//   - Audio: Datei nicht abgeschnitten
//   - Lizenztexte: CC0-Wortlaut vorhanden
// Prueft NICHT die Audio-Inhalte (ffprobe macht das, siehe README).
//
// Aufruf: node tools/verify_assets.mjs [model_dir] [audio_dir]
// Ohne Argumente werden public/media/models und public/media/audio geprueft.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_DIR = process.argv[2] ?? 'public/media/models';
const AUDIO_DIR = process.argv[3] ?? 'public/media/audio';

let failed = 0;
/** Markiert einen Fehler und zaehlt ihn. */
function fail(msg) {
  console.log(`  [FAIL] ${msg}`);
  failed += 1;
}

const models = readdirSync(MODEL_DIR).filter((f) => f.endsWith('.glb')).sort();
console.log(`--- Modelle (${models.length} GLB) ---`);
for (const name of models) {
  const file = join(MODEL_DIR, name);
  const buf = readFileSync(file);
  if (buf.toString('latin1', 0, 4) !== 'glTF') {
    fail(`${name}: Magic-Bytes sind nicht "glTF"`);
    continue;
  }
  let gltf;
  try {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  } catch (err) {
    fail(`${name}: nicht parsebar (${err.message})`);
    continue;
  }
  gltf.scene.updateWorldMatrix(true, true);
  let tris = 0;
  const materials = new Set();
  const box = new Box3();
  const v = new Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mat = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mat) {
      materials.add(m?.name || m?.type || 'unbekannt');
      if (m?.map || m?.normalMap || m?.roughnessMap) {
        fail(`${name}: Material "${m.name}" hat eine Bildtextur — Modell muss texturlos bleiben`);
      }
    }
    const pos = o.geometry.getAttribute('position');
    const idx = o.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    tris += Math.floor(count / 3);
    // Achtung: bei indizierter Geometrie NUR ueber den Index laufen —
    // pos.count ist groesser als idx.count, ein Ueberlauf ergaebe undefined
    // und damit NaN in der Bounding-Box.
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  const size = box.getSize(new Vector3());
  if (tris === 0) fail(`${name}: 0 Dreiecke`);
  if (size.length() === 0) fail(`${name}: leere Bounding-Box`);
  const images = gltf.parser?.json?.images?.length ?? 0;
  if (images > 0) fail(`${name}: ${images} eingebettete Bild(er) im glTF-JSON`);
  console.log(
    `  [OK ] ${name.padEnd(24)} ${String(buf.length).padStart(6)} B  ` +
      `${String(tris).padStart(4)} Dreiecke  ${[...materials].join(', ')}`,
  );
  console.log(
    `         Groesse (${size.toArray().map((n) => n.toFixed(3)).join(' x ')})`,
  );
}

const audio = readdirSync(AUDIO_DIR).filter((f) => /\.(ogg|mp3)$/.test(f)).sort();
console.log(`--- Audio (${audio.length} Dateien) ---`);
if (audio.length === 0) fail('keine Audiodateien gefunden');
for (const name of audio) {
  const buf = readFileSync(join(AUDIO_DIR, name));
  if (buf.length < 512) fail(`${name}: zu klein (${buf.length} B) — vermutlich abgeschnitten`);
  else console.log(`  [OK ] ${name.padEnd(24)} ${String(buf.length).padStart(6)} B`);
}

const licenses = readdirSync(MODEL_DIR)
  .filter((f) => /^License-.*\.txt$/.test(f))
  .map((f) => ({ name: f, path: join(MODEL_DIR, f) }))
  .concat(
    readdirSync(AUDIO_DIR)
      .filter((f) => /^License-.*\.txt$/.test(f))
      .map((f) => ({ name: f, path: join(AUDIO_DIR, f) })),
  );
console.log(`--- Lizenztexte (${licenses.length}) ---`);
if (licenses.length < 3) fail('erwartet 3 Lizenztexte (Space Kit, Sci-Fi Sounds, Interface Sounds)');
for (const l of licenses) {
  const txt = readFileSync(l.path, 'utf8');
  if (!/Creative Commons Zero, CC0/.test(txt)) fail(`${l.name}: enthaelt keinen CC0-Text`);
  else console.log(`  [OK ] ${l.name}`);
}

console.log(failed === 0 ? '\nAlle Asset-Pruefungen bestanden.' : `\n${failed} Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
