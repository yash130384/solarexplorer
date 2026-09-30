/**
 * Textur-Management fuer SolarExplorer.
 *
 * Alle Texturen liegen lokal unter `public/media/textures/<bodyId>.png` und
 * werden von `tools/generate_textures.py` prozedural erzeugt (offline, keine
 * CDN, keine fremden Bildlizenzen). `public/` ist Vites publicDir: die Dateien
 * werden 1:1 nach `dist/` kopiert und sind ueber `./media/textures/...`
 * erreichbar — ohne Hash, also mit stabilem Pfad. Fehlt eine Textur, faellt
 * die Kugel auf die `color` aus `bodies.json` zurueck, ohne harten Fehler.
 */

import * as THREE from 'three';
import { FEATURED_MOON_IDS } from './InstancedMoons';

/** Typ eines Koerpers aus `bodies.json`. */
export type BodyType = 'star' | 'planet' | 'moon';

/** Minimale Form eines Eintrags aus `bodies.json` (was die Texturen brauchen). */
export interface BodyLike {
  id: string;
  type: BodyType;
  color: string;
  name?: string;
}

/** Basispfad der Texturen, relativ zur ausgelieferten Seite. */
const TEXTURE_BASE = './media/textures';

/** Map von `bodyId` -> geladene Textur. */
const cache = new Map<string, THREE.Texture>();

/** Map von `bodyId` -> geladene Rauheits-Textur. */
const roughnessCache = new Map<string, THREE.Texture>();

/** Map von `bodyId` -> geladene Normal-Textur. */
const normalCache = new Map<string, THREE.Texture>();

/**
 * Gibt die lokale URL der Rauheits-Textur eines Koerpers zurueck.
 *
 * @param bodyId - `id` aus `bodies.json`.
 * @returns Relative URL der PNG oder `null`.
 */
export function roughnessTextureUrl(bodyId: string): string | null {
  const key = bodyId.trim().toLowerCase();
  if (key.length === 0) return null;
  return `${TEXTURE_BASE}/${encodeURIComponent(key)}_roughness.png`;
}

/**
 * Gibt die lokale URL der Normal-Textur eines Koerpers zurueck.
 *
 * @param bodyId - `id` aus `bodies.json`.
 * @returns Relative URL der PNG oder `null`.
 */
export function normalTextureUrl(bodyId: string): string | null {
  const key = bodyId.trim().toLowerCase();
  if (key.length === 0) return null;
  return `${TEXTURE_BASE}/${encodeURIComponent(key)}_normal.png`;
}

/**
 * Gibt die lokale URL der Textur eines Koerpers zurueck.
 *
 * Der Pfad wird nicht gegen das Dateisystem geprueft — das wuerde einen
 * synchronen fs-Zugriff im Browser-Pfad bedeuten. Fehlt die PNG, liefert der
 * Loader ein 404 und {@link loadBodyTexture} faellt sauber auf die Farbe zurueck.
 *
 * @param bodyId - `id` aus `bodies.json`, z. B. `erde`.
 * @returns Relative URL der PNG.
 */
export function textureUrl(bodyId: string): string | null {
  const key = bodyId.trim().toLowerCase();
  if (key.length === 0) return null;
  return `${TEXTURE_BASE}/${encodeURIComponent(key)}.png`;
}

/**
 * Laedt alle Texturen parallel vor (z. B. beim Start, bevor die Szene aufbaut).
 *
 * Laedt Farb-, Rauheits- und Normal-Maps fuer alle angefragten Koerper.
 * Fehlende Dateien werden uebersprungen, statt einen Fehler zu werfen.
 *
 * @param bodyIds - IDs der Koerper, z. B. `['erde', 'mars']`.
 * @returns Promise, das erfuellt ist, wenn alle vorhandenen Texturen geladen sind.
 */
export async function preloadTextures(bodyIds: string[]): Promise<void> {
  const loader = new THREE.TextureLoader();
  const loads: Promise<void>[] = [];
  for (const id of bodyIds) {
    const key = id.trim().toLowerCase();
    if (key.length === 0) continue;

    // Farbtextur
    if (!cache.has(key)) {
      const url = textureUrl(key);
      if (url !== null) {
        loads.push(
          loader
            .loadAsync(url)
            .then((texture) => {
              configureTexture(texture);
              cache.set(key, texture);
            })
            .catch(() => {}),
        );
      }
    }

    // Rauheits-Textur
    if (!roughnessCache.has(key)) {
      const rUrl = roughnessTextureUrl(key);
      if (rUrl !== null) {
        loads.push(
          loader
            .loadAsync(rUrl)
            .then((texture) => {
              configureRoughnessTexture(texture);
              roughnessCache.set(key, texture);
            })
            .catch(() => {}),
        );
      }
    }

    // Normal-Textur
    if (!normalCache.has(key)) {
      const nUrl = normalTextureUrl(key);
      if (nUrl !== null) {
        loads.push(
          loader
            .loadAsync(nUrl)
            .then((texture) => {
              configureNormalTexture(texture);
              normalCache.set(key, texture);
            })
            .catch(() => {}),
        );
      }
    }
  }
  await Promise.all(loads);
}

/**
 * Liefert die IDs der Koerper, fuer die es eine prozedurale Textur gibt.
 *
 * Das sind die acht Planeten und die sieben benannten Monde — genau die
 * Koerper mit eigenem Mesh. Kleine Monde werden instanziert und teilen sich
 * ein Material, eine Textur pro Instanz waere dort doppelt bezahlt; die
 * Sonne bleibt einfarbig, weil ihre Farbe auf HDR gehoben wird (siehe
 * `BodyFactory.createMaterial`).
 *
 * Der Filter ist bewusst **whitelist-basiert** und nicht "alle Koerper": 456
 * Monde ohne Datei wuerden 456 ausschlagende Requests und 456 Konsolenfehler
 * erzeugen, und der E2E-Lauf verlangt eine fehlerfreie Konsole.
 *
 * @param bodies - Koerper aus `bodies.json` (nur `id` und `type` noetig).
 * @returns Die IDs in der Reihenfolge der Eingabeliste, ohne Duplikate.
 */
export function texturedBodyIds(bodies: readonly BodyLike[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const body of bodies) {
    const key = body.id.trim().toLowerCase();
    const wanted = body.type === "planet" || FEATURED_MOON_IDS.has(key);
    if (!wanted || key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    ids.push(key);
  }
  return ids;
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
 * Liefert eine bereits geladene Rauheits-Textur, falls vorhanden.
 *
 * @param bodyId - ID des Koerpers.
 * @returns Die Textur oder `null`.
 */
export function getRoughnessTexture(bodyId: string): THREE.Texture | null {
  return roughnessCache.get(bodyId.trim().toLowerCase()) ?? null;
}

/**
 * Liefert eine bereits geladene Normal-Textur, falls vorhanden.
 *
 * @param bodyId - ID des Koerpers.
 * @returns Die Textur oder `null`.
 */
export function getNormalTexture(bodyId: string): THREE.Texture | null {
  return normalCache.get(bodyId.trim().toLowerCase()) ?? null;
}

/**
 * Laedt die Rauheits-Textur eines Koerpers.
 *
 * @param body - Koerper-Eintrag aus `bodies.json`.
 * @returns Aufgeloeste Textur (oder `null`).
 */
export async function loadBodyRoughnessTexture(
  body: BodyLike,
): Promise<THREE.Texture | null> {
  const key = body.id.trim().toLowerCase();
  const existing = roughnessCache.get(key);
  if (existing !== undefined) return existing;

  const url = roughnessTextureUrl(key);
  if (url === null) return null;

  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    configureRoughnessTexture(texture);
    roughnessCache.set(key, texture);
    return texture;
  } catch {
    return null;
  }
}

/**
 * Laedt die Normal-Textur eines Koerpers.
 *
 * @param body - Koerper-Eintrag aus `bodies.json`.
 * @returns Aufgeloeste Textur (oder `null`).
 */
export async function loadBodyNormalTexture(
  body: BodyLike,
): Promise<THREE.Texture | null> {
  const key = body.id.trim().toLowerCase();
  const existing = normalCache.get(key);
  if (existing !== undefined) return existing;

  const url = normalTextureUrl(key);
  if (url === null) return null;

  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    configureNormalTexture(texture);
    normalCache.set(key, texture);
    return texture;
  } catch {
    return null;
  }
}

/**
 * Gibt alle geladenen Texturen frei und leert alle Caches.
 *
 * @returns void
 */
export function disposeTextures(): void {
  for (const texture of cache.values()) {
    texture.dispose();
  }
  cache.clear();
  for (const texture of roughnessCache.values()) {
    texture.dispose();
  }
  roughnessCache.clear();
  for (const texture of normalCache.values()) {
    texture.dispose();
  }
  normalCache.clear();
}

/**
 * Konfiguriert eine Farb-Textur fuer die Nutzung auf einer Kugel.
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

/**
 * Konfiguriert eine Rauheits-Textur (linear, kein sRGB).
 *
 * @param texture - Zu konfigurierende Textur.
 * @returns void
 */
function configureRoughnessTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

/**
 * Konfiguriert eine Normal-Textur (linear, kein sRGB).
 *
 * @param texture - Zu konfigurierende Textur.
 * @returns void
 */
function configureNormalTexture(texture: THREE.Texture): void {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}
