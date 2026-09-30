// Selbsttest fuer verify_assets.mjs: legt ein kaputtes GLB und eine
// fehlende Lizenzdatei in ein temporaeres Verzeichnis, laesst die Pruefung
// laufen und erwartet einen Exit-Code 1.
//
// Aufruf: node tools/verify_assets.selftest.mjs
// Laeuft in einem temporaeren Verzeichnis neben dem Repo, damit die
// node_modules-Aufloesung von Node greift (ein Symlink aus /tmp loest 'three'
// nicht auf — der Import landet dann im /tmp-Paketverzeichnis).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = process.cwd();
let failed = 0;

/** Legt ein Verzeichnis mit allen echten Assets plus Fehlern an. */
function buildFixture(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'assets-selftest-'));
  cpSync(join(REPO, 'public/media/models'), join(dir, 'models'), { recursive: true });
  cpSync(join(REPO, 'public/media/audio'), join(dir, 'audio'), { recursive: true });
  mutate(join(dir, 'models'), join(dir, 'audio'));
  return dir;
}

/** Fuehrt verify_assets.mjs im Fixture aus und liefert exitCode + output. */
function run(dir) {
  try {
    const out = execFileSync(
      'node',
      [join(REPO, 'tools/verify_assets.mjs'), join(dir, 'models'), join(dir, 'audio')],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function check(name, condition, detail) {
  if (condition) console.log(`  [OK ] ${name}`);
  else {
    console.log(`  [FAIL] ${name} — ${detail}`);
    failed += 1;
  }
}

// --- Fall 1: korrekte Assets -> Exit 0
{
  const dir = buildFixture(() => {});
  const r = run(dir);
  check('unveraenderte Assets bestehen (Exit 0)', r.code === 0, `Exit ${r.code}: ${r.out.slice(-300)}`);
  rmSync(dir, { recursive: true, force: true });
}

// --- Fall 2: abgeschnittenes GLB -> Exit 1, Meldung nennt die Datei
{
  const dir = buildFixture((models) => {
    const f = join(models, 'schiff_racer.glb');
    writeFileSync(f, readFileSync(f).subarray(0, 64));
  });
  const r = run(dir);
  check('kaputtes GLB wird erkannt (Exit 1)', r.code === 1, `Exit ${r.code}: ${r.out.slice(-300)}`);
  check('Meldung nennt schiff_racer.glb', r.out.includes('schiff_racer.glb'), r.out.slice(-300));
  rmSync(dir, { recursive: true, force: true });
}

// --- Fall 3: fehlende Lizenz -> Exit 1
{
  const dir = buildFixture((models) => {
    rmSync(join(models, 'License-Kenney-SpaceKit.txt'));
  });
  const r = run(dir);
  check('fehlende Lizenzdatei wird erkannt (Exit 1)', r.code === 1, `Exit ${r.code}: ${r.out.slice(-300)}`);
  check('Meldung nennt Lizenztexte', r.out.includes('Lizenztexte'), r.out.slice(-300));
  rmSync(dir, { recursive: true, force: true });
}

// --- Fall 4: Modell mit Bildtextur -> Exit 1 (waechst der Download ungeplant)
{
  const dir = buildFixture((models) => {
    // Minimales glTF mit einem Material, das auf eine Bilddatei verweist.
    const gltf = {
      asset: { version: '2.0' },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Mesh_test' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, indices: 1 }] }],
      materials: [{ name: 'mitBild', pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: 'daten:image/png;base64,iVBORw0KGgo=' }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
      ],
      buffers: [{ byteLength: 42 }],
    };
    const bin = Buffer.alloc(42);
    for (let i = 0; i < 3; i++) bin.writeFloatLE(i, i * 12);
    bin.writeUInt16LE(0, 36);
    bin.writeUInt16LE(1, 38);
    bin.writeUInt16LE(2, 40);
    const json = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPad = (4 - (json.length % 4)) % 4;
    const total = 12 + 8 + json.length + jsonPad + 8 + bin.length;
    const glb = Buffer.alloc(total);
    glb.write('glTF', 0, 'latin1');
    glb.writeUInt32LE(total, 4);
    glb.writeUInt32LE(total, 8);
    glb.writeUInt32LE(json.length + jsonPad, 12);
    glb.write('JSON', 16, 'latin1');
    json.copy(glb, 20);
    glb.writeUInt32LE(bin.length, 20 + json.length + jsonPad);
    glb.write('BIN\0', 24 + json.length + jsonPad, 'latin1');
    bin.copy(glb, 28 + json.length + jsonPad);
    writeFileSync(join(models, 'mitbild.glb'), glb);
  });
  const r = run(dir);
  check('Modell mit Bildtextur wird erkannt (Exit 1)', r.code === 1, `Exit ${r.code}: ${r.out.slice(-400)}`);
  check(
    'Meldung nennt mitbild.glb',
    r.out.includes('mitbild.glb'),
    r.out.slice(-400),
  );
  rmSync(dir, { recursive: true, force: true });
}

console.log(failed === 0 ? '\nSelbsttest bestanden.' : `\n${failed} Selbsttest-Pruefung(en) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
