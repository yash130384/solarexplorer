// Druckt exakte Normalisierungskonstanten (center, scale, position) fuer ein GLB.
// Ziel: Laenge 1.0 Szeneneinheit entlang Z. Rechnet mit voller Praezision,
// gerundet wird erst bei der Ausgabe.
// Ohne Argument werden alle GLB unter public/media/models/ geprueft.
import { readFileSync, readdirSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TARGET = 1.0;
const MODEL_DIR = 'public/media/models';

const args = process.argv.slice(2);
const files = args.length > 0
  ? args
  : readdirSync(MODEL_DIR).filter((f) => f.endsWith('.glb')).sort()
      .map((f) => `${MODEL_DIR}/${f}`);

if (files.length === 0) {
  console.error(`Keine GLB in ${MODEL_DIR} gefunden.`);
  process.exit(1);
}

for (const file of files) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  gltf.scene.updateWorldMatrix(true, true);
  const box = new Box3();
  const v = new Vector3();
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const scale = TARGET / size.z;
  const p = center.clone().multiplyScalar(-scale);
  const f = (n) => n.toFixed(6);
  console.log(`=== ${file}`);
  console.log(`  min    = (${box.min.toArray().map(f).join(', ')})`);
  console.log(`  max    = (${box.max.toArray().map(f).join(', ')})`);
  console.log(`  size   = (${size.toArray().map(f).join(', ')})`);
  console.log(`  center = (${center.toArray().map(f).join(', ')})`);
  console.log(`  scale  = ${f(scale)}`);
  console.log(`  group.position.set(${p.toArray().map(f).join(', ')});`);
  console.log(`  group.scale.setScalar(${f(scale)});`);
  // Bug/Heck nach der Rotation um PI (Projekt-Konvention: +Z = Flugrichtung)
  const noseZ = (box.min.z - center.z) * scale;
  const tailZ = (box.max.z - center.z) * scale;
  console.log(`  vor rotation.y=PI: minZ-Seite=${f(noseZ)} maxZ-Seite=${f(tailZ)}`);
  console.log(`  nach rotation.y=PI: Bug(Nase) bei z=${f(-noseZ)}, Heck bei z=${f(-tailZ)}`);
}
