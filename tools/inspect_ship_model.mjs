// Prüfwerkzeug für das Schiff-Modell: misst Bounding-Box, Dreiecke, Materialien
// und rasterisiert die Silhouette, damit Nase (Flugrichtung) eindeutig ist.
//
// Aufruf: node tools/inspect_ship_model.mjs [datei.glb ...]
// Ohne Argument werden alle GLB unter public/media/models/ geprüft.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_DIR = 'public/media/models';
const WIDTH = 72;

/** Rendert eine Ansicht der Dreiecke als ASCII. */
function render(tris, ax, ay, label) {
  const xs = tris.flat().map((p) => p[ax]);
  const ys = tris.flat().map((p) => p[ay]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const h = Math.max(6, Math.round((WIDTH * sy) / sx / 2));
  const grid = Array.from({ length: h }, () => new Array(WIDTH).fill(' '));
  const map = (p) => [
    ((p[ax] - minX) / sx) * (WIDTH - 1),
    (1 - (p[ay] - minY) / sy) * (h - 1),
  ];
  const inTri = (px, py, a, b, c) => {
    const d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1]);
    const d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1]);
    const d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (const t of tris) {
    const g = t.map(map);
    for (let y = Math.max(0, Math.floor(Math.min(g[0][1], g[1][1], g[2][1]))); y <= Math.min(h - 1, Math.ceil(Math.max(g[0][1], g[1][1], g[2][1]))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(g[0][0], g[1][0], g[2][0]))); x <= Math.min(WIDTH - 1, Math.ceil(Math.max(g[0][0], g[1][0], g[2][0]))); x++) {
        if (inTri(x, y, g[0], g[1], g[2])) grid[y][x] = '#';
      }
    }
  }
  const axName = ['X', 'Y', 'Z'][ax];
  const ayName = ['X', 'Y', 'Z'][ay];
  console.log(`--- ${label}: rechts=${axName} [${minX.toFixed(2)}..${maxX.toFixed(2)}]  oben=${ayName} [${minY.toFixed(2)}..${maxY.toFixed(2)}]`);
  for (const row of grid) console.log(row.join(''));
}

/** Liest ein GLB und misst es. */
async function inspect(file) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  gltf.scene.updateWorldMatrix(true, true);
  const tris = [];
  const materials = new Set();
  const names = [];
  const box = new Box3();
  const v = new Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    names.push(o.name);
    const mat = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mat) materials.add(m?.name || m?.type || 'unbekannt');
    const pos = o.geometry.getAttribute('position');
    const idx = o.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    const at = (i) => {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      return [v.x, v.y, v.z];
    };
    for (let i = 0; i + 2 < count; i += 3) {
      const t = [at(i), at(i + 1), at(i + 2)];
      for (const p of t) box.expandByPoint(new Vector3(p[0], p[1], p[2]));
      tris.push(t);
    }
  });
  const size = box.getSize(new Vector3());
  console.log(`=== ${file}`);
  console.log(`    bytes=${buf.length}  dreiecke=${tris.length}  meshes=${names.length}`);
  console.log(`    materialien=${[...materials].join(', ')}`);
  console.log(`    knoten=${names.join(', ')}`);
  console.log(`    bbox min=${box.min.toArray().map((n) => n.toFixed(3)).join(' ')}  max=${box.max.toArray().map((n) => n.toFixed(3)).join(' ')}`);
  console.log(`    groesse=${size.toArray().map((n) => n.toFixed(3)).join(' ')}  mitte=${box.getCenter(new Vector3()).toArray().map((n) => n.toFixed(3)).join(' ')}`);
  render(tris, 2, 1, 'Draufsicht');
  render(tris, 2, 0, 'Seitenansicht');
  return { tris, box, size };
}

const files = process.argv.slice(2);
const targets = files.length > 0
  ? files
  : existsSync(MODEL_DIR)
    ? readdirSync(MODEL_DIR).filter((f) => f.endsWith('.glb') || f.endsWith('.gltf')).map((f) => join(MODEL_DIR, f))
    : [];

if (targets.length === 0) {
  console.log(`Keine GLB in ${MODEL_DIR} gefunden.`);
} else {
  for (const file of targets) {
    await inspect(file);
  }
}
