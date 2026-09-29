/**
 * Textur-Management fuer SolarExplorer.
 *
 * Alle Texturen liegen lokal unter `src/assets/textures/<bodyId>.png` und werden
 * von `tools/generate_textures.py` prozedural erzeugt (offline, keine CDN,
 * keine fremden Bildlizenzen). Vite loest die Dateien ueber `import.meta.glob`
 * auf, dadurch existieren sie erst zur Build-Zeit — fehlt eine Textur, faellt
 * die Kugel auf die `color` aus `bodies.json` zurueck, ohne harten Fehler.
 */

import * as THREE from 'three';

/** Typ eines Koerpers aus `bodies.json`. */
export type BodyType = 'star' | 'planet' | 'moon';

/** Minimale Form eines Eintrags aus `bodies.json` (was die Texturen brauchen). */
export interface BodyLike {
  id: string;
  type: BodyType;
  color: string;
  name?: string;
}

/**
 * Vite-Glob auf alle erzeugten Texturen. Wert ist die relative URL,
 * die Vite beim Build in einen gehashten Asset-Namen uebersetzt.
 */
const TEXTURE_URLS = import.meta.glob('../assets/textures/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Map von `bodyId` -> geladene Textur. */
const cache = new Map<string, THREE.Texture>();

/**
 * Gibt die lokale URL der Textur eines Koerpers zurueck.
 *
 * @param bodyId - `id` aus `bodies.json`, z. B. `earth`.
 * @returns Relative URL der PNG oder `null`, wenn keine existiert.
 */
export function textureUrl(bodyId: string): string | null {
  const key = bodyId.trim().toLowerCase();
  if (key.length === 0) return null;
  return TEXTURE_URLS[`../assets/textures/${key}.png`] ?? null;
}

/**
 * Laedt alle Texturen parallel vor (z. B. beim Start, bevor die Szene aufbaut).
 *
 * Fehlende Dateien werden uebersprungen, statt einen Fehler zu werfen.
 *
 * @param bodyIds - IDs der Koerper, z. B. `['earth', 'mars']`.
 * @returns Promise, das erfuellt ist, wenn alle vorhandenen Texturen geladen sind.
 */
export async function preloadTextures(bodyIds: string[]): Promise<void> {
  const loader = new THREE.TextureLoader();
  const loads: Promise<void>[] = [];
  for (const id of bodyIds) {
    const key = id.trim().toLowerCase();
    if (key.length === 0 || cache.has(key)) continue;
    const url = textureUrl(key);
    if (url === null) continue;
    loads.push(
      loader.loadAsync(url).then((texture) => {
        configureTexture(texture);
        cache.set(key, texture);
      }),
    );
  }
  await Promise.all(loads);
}

/**
 * Laedt die Textur eines Koerpers und liefert sie zusammen mit der Fallback-Farbe.
 *
 * @param body - Koerper-Eintrag aus `bodies.json`.
 * @returns Aufgeloeste Textur (oder `null`) und die Farbe aus `bodies.json`.
 */
export async function loadBodyTexture(
  body: BodyLike,
): Promise<{ texture: THREE.Texture | null; color: string }> {
  const key = body.id.trim().toLowerCase();
  const existing = cache.get(key);
  if (existing !== undefined) return { texture: existing, color: body.color };

  const url = textureUrl(key);
  if (url === null) return { texture: null, color: body.color };

  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    configureTexture(texture);
    cache.set(key, texture);
    return { texture, color: body.color };
  } catch {
    // Textur nicht im Build enthalten -> einfarbiges Material
    return { texture: null, color: body.color };
  }
}

/**
 * Liefert eine bereits geladene Textur, falls vorhanden (synchron).
 *
 * @param bodyId - ID des Koerpers.
 * @returns Die Textur oder `null`.
 */
export function getTexture(bodyId: string): THREE.Texture | null {
  return cache.get(bodyId.trim().toLowerCase()) ?? null;
}

/**
 * Gibt alle geladenen Texturen frei und leert den Cache.
 *
 * @returns void
 */
export function disposeTextures(): void {
  for (const texture of cache.values()) {
    texture.dispose();
  }
  cache.clear();
}

/**
 * Konfiguriert eine Textur fuer die Nutzung auf einer Kugel.
 *
 * @param texture - Zu konfigurierende Textur.
 * @returns void
 */
function configureTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}
