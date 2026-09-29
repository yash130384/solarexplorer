/**
 * Das Raumschiff des SolarExplorers: Modell, Flugphysik und Zustand.
 *
 * Das Schiff ist ein kleiner, freundlicher "Shuttle" aus reinen
 * Three.js-Primitiveen. Der mathematische Teil (Klemmen, Beschleunigung,
 * Geschwindigkeit) lebt bewusst in dieser Datei und nicht in `src/core/*`,
 * weil er die Three.js-Objektorientierung braucht — die eigentliche
 * Flugphysik bleibt aber frei von Renderer-Zugriffen und damit testbar.
 *
 * **Vorwaerts-Achse:** Das Modell zeigt mit seiner lokalen **+Z-Achse** in
 * Flugrichtung (Three.js-Standard-Konvention: Objekte blicken nach `+Z`).
 * Das Cockpit sitzt deshalb vorne bei `+z`, die Triebwerks-Glows hinten bei
 * `-z`.
 *
 * **Einheiten:** Position und Geschwindigkeit werden in *Szeneneinheiten*
 * gefuehrt (das ist die Einheit, in der auch `src/core/scale.ts` rechnet).
 * Nur fuer das HUD wird die Geschwindigkeit ueber
 * {@link kmPerSceneUnit} in km/s umgerechnet.
 *
 * @module scene/Ship
 */

import * as THREE from "three";
import {
  AU_KM,
  LOG_DISTANCE_SCALE,
  VISUAL_DISTANCE_EXPONENT,
  VISUAL_DISTANCE_FACTOR,
} from "../core/constants";
import { scaleRadius } from "../core/scale";
import type { DistanceMode, ScaleMode } from "../core/scale";
import type { Vec3 } from "../core/orbital";

/** Fiktiver Radius des Schiffsrumpfes in Kilometern (20 m — ein Space Shuttle). */
export const SHIP_HULL_RADIUS_KM = 0.02;

/**
 * Kleinster erlaubter Rumpfradius in Szeneneinheiten.
 *
 * Im Modus `real` waere ein 20-m-Schiff kleiner als ein Pixel — man kann
 * dann zwar „echte Verhaeltnisse" sehen, aber nicht mehr fliegen. Deshalb
 * wird der Rumpf auf diese Mindestgroesse gehoben.
 */
export const SHIP_MIN_VISIBLE_RADIUS = 0.35;

/** Beschleunigung bei vollem Schub in Szeneneinheiten pro Sekunde^2. */
export const SHIP_ACCELERATION = 1.4;

/** Luftwiderstands-Beiwert: Geschwindigkeit pro Sekunde wird damit multipliziert. */
export const SHIP_DRAG_PER_SECOND = 0.35;

/** Hoechstgeschwindigkeit in Szeneneinheiten pro Sekunde. */
export const SHIP_MAX_SPEED = 12;

/** Unterhalb dieser Geschwindigkeit gilt das Schiff als stehend (HUD-Rauschen). */
export const SHIP_EPSILON_SPEED = 1e-4;

/** Groesse des Cockpits relativ zum Rumpfradius. */
const COCKPIT_SCALE = 0.62;

/** Wie weit das Cockpit nach vorne (+Z) versetzt ist, relativ zum Rumpfradius. */
const COCKPIT_OFFSET = 0.85;

/** Spannweite der Fluegel relativ zum Rumpfradius. */
const WING_SPAN = 4.2;

/** Dicke der Fluegel relativ zum Rumpfradius. */
const WING_THICKNESS = 0.12;

/** Abstand der Triebwerke vom Rumpfzentrum nach hinten, relativ zum Rumpfradius. */
const ENGINE_OFFSET = 1.5;

/** Radius der Triebwerks-Glows relativ zum Rumpfradius. */
const ENGINE_GLOW_SCALE = 0.28;

/** Reichweite des Triebwerkslichts relativ zum Rumpfradius. */
const ENGINE_LIGHT_RANGE = 30;

/** Farbe des Rumpfes: helles Blau-Weiss, deutlich gegen den dunklen Weltraum. */
const HULL_COLOR = 0xe8f2ff;

/** Akzentfarbe der Fluegel und Triebwerke: warmes Orange. */
const ACCENT_COLOR = 0xff8a1a;

/** Farbe des Cockpits: dunkles Blau mit leichter Transparenz. */
const CANOPY_COLOR = 0x1b3a63;

/** Farbe des Triebwerk-Glows. */
const GLOW_COLOR = 0xffb347;

/** Namen der beiden Triebwerke (fuer Debugging und Tests). */
const ENGINE_L = "triebwerk-l";
const ENGINE_R = "triebwerk-r";

/** Maximaler Nickwinkel in Grad — verhindert, dass das Schiff kopfsteht. */
export const PITCH_LIMIT_DEG = 85;

/**
 * Berechnet, wie viele Kilometer eine Szeneneinheit im jeweiligen
 * Distanzmodus darstellt.
 *
 * Die Distanzmodi aus `src/core/scale.ts` legen fest, wie viele
 * Szeneneinheiten eine Astronomische Einheit belegt; daraus folgt der
 * Umrechnungsfaktor fuer die Geschwindigkeitsanzeige im HUD.
 *
 * @param distanceMode - Aktiver Distanzmodus.
 * @returns Kilometer pro Szeneneinheit (immer > 0).
 */
export function kmPerSceneUnit(distanceMode: DistanceMode): number {
  switch (distanceMode) {
    case "real":
      // 1 AE = 1 Szeneneinheit.
      return AU_KM;
    case "log":
      return AU_KM / (LOG_DISTANCE_SCALE * Math.log(2));
    case "visual":
      return AU_KM / (VISUAL_DISTANCE_FACTOR * Math.pow(1, VISUAL_DISTANCE_EXPONENT));
    default:
      throw new RangeError(`Unbekannter DistanceMode: ${String(distanceMode)}.`);
  }
}

/**
 * Klemmt eine Zahl auf einen Bereich.
 *
 * @param value - Zu klemmender Wert.
 * @param min - Untere Grenze.
 * @param max - Obere Grenze.
 * @returns Der geklemmte Wert.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Das steuerbare Raumschiff: Mesh-Gruppe, Flugrichtung und Geschwindigkeit.
 *
 * Alle Methoden sind bewusst klein und ohne Seiteneffekte auf die Szene —
 * `dispose()` ist die einzige Methode, die Three.js-Ressourcen freigibt.
 */
export class Ship {
  /** Wurzelgruppe des Schiffs; zeigt mit `+Z` in Flugrichtung. */
  private readonly group: THREE.Group;

  /** Aktuelle Position in Szeneneinheiten. */
  private position: Vec3 = { x: 0, y: 0, z: 0 };

  /** Aktuelle Geschwindigkeit in Szeneneinheiten pro Sekunde. */
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };

  /** Aktiver Nickwinkel in Grad, auf +/- {@link PITCH_LIMIT_DEG} begrenzt. */
  private pitchDeg = 0;

  /** Aktiver Gierwinkel in Grad, frei drehbar. */
  private yawDeg = 0;

  /** Aktiver Schubanteil (0..1) fuer die HUD-Anzeige. */
  private thrustLevel = 0;

  /** Kilometer pro Szeneneinheit, abgeleitet aus dem Distanzmodus. */
  private readonly kmPerUnit: number;

  /** Rumpfradius in Szeneneinheiten, abgeleitet aus dem Radiusmodus. */
  private readonly hullRadius: number;

  /**
   * Baut das Schiffmodell und richtet es auf den Ursprung aus.
   *
   * @param scaleMode - Modus der Radius-Skalierung; bestimmt die
   *   Darstellungsgroesse des Rumpfes.
   * @param distanceMode - Modus der Distanz-Skalierung; bestimmt, mit welchem
   *   Faktor `getSpeedKmS()` in km/s umrechnet.
   * @throws {RangeError} Wenn einer der Modi unbekannt ist.
   */
  constructor(
    scaleMode: ScaleMode,
    distanceMode: DistanceMode,
  ) {
    this.hullRadius = Math.max(
      SHIP_MIN_VISIBLE_RADIUS,
      scaleRadius(SHIP_HULL_RADIUS_KM, scaleMode),
    );
    this.kmPerUnit = kmPerSceneUnit(distanceMode);
    this.group = this.buildModel();
  }

  /**
   * Erzeugt die Mesh-Gruppe des Schiffs.
   *
   * Aufbau (Ursprung in der Gruppenmitte, Nase zeigt nach `+Z`):
   * - Rumpf: liegende Capsule,
   * - Cockpit: halbe Kugel, transparent, leicht nach vorne versetzt,
   * - zwei Fluegel als flache Boxen (orange Akzent),
   * - zwei Triebwerke: kleine Emissions-Kegel plus additive Glow-Kugeln
   *   und ein schwaches `PointLight` als Warmequelle.
   *
   * @returns Die fertige Gruppe (noch nicht in eine Szene gehaengt).
   */
  private buildModel(): THREE.Group {
    const r = this.hullRadius;
    const group = new THREE.Group();
    group.name = "raumschiff";
    // Yaw (Y) zuerst, dann Pitch (X): so bleibt "oben" beim Nicken stabil.
    group.rotation.order = "YXZ";

    const hullMaterial = new THREE.MeshStandardMaterial({
      color: HULL_COLOR,
      roughness: 0.45,
      metalness: 0.15,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color: ACCENT_COLOR,
      roughness: 0.6,
      metalness: 0.1,
      emissive: new THREE.Color(ACCENT_COLOR),
      emissiveIntensity: 0.15,
    });
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: CANOPY_COLOR,
      roughness: 0.15,
      metalness: 0.4,
      transparent: true,
      opacity: 0.75,
    });
    const engineMaterial = new THREE.MeshBasicMaterial({ color: GLOW_COLOR });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: GLOW_COLOR,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Rumpf: Capsule entlang der Y-Achse -> um 90 Grad gedreht zur Z-Achse.
    const hull = new THREE.Mesh(
      new THREE.CapsuleGeometry(r * 0.55, r * 1.4, 6, 20),
      hullMaterial,
    );
    hull.name = "rumpf";
    hull.rotation.x = Math.PI / 2;
    group.add(hull);

    // Nase: kleiner Kegel, damit die Flugrichtung auch aus der Distanz lesbar ist.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, r * 0.9, 20), hullMaterial);
    nose.name = "nase";
    nose.rotation.x = Math.PI / 2;
    nose.position.z = r * 1.25;
    group.add(nose);

    // Cockpit: obere Haelfte einer Kugel, leicht nach vorne versetzt.
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(
        r * COCKPIT_SCALE,
        24,
        12,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      canopyMaterial,
    );
    canopy.name = "cockpit";
    canopy.position.set(0, r * 0.3, r * COCKPIT_OFFSET);
    group.add(canopy);

    // Fluegel / Querfelder links und rechts.
    for (const side of [-1, 1] as const) {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(r * WING_SPAN, r * WING_THICKNESS, r * 0.9),
        accentMaterial,
      );
      wing.name = side < 0 ? "fluegel-links" : "fluegel-rechts";
      wing.position.set((side * r * WING_SPAN) / 2 - side * r * 0.3, 0, -r * 0.2);
      wing.rotation.z = side * 0.12;
      group.add(wing);
    }

    // Triebwerke: Kegel als Flamme plus additive Glow-Kugel und Licht.
    for (const side of [-1, 1] as const) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(r * ENGINE_GLOW_SCALE, r * 0.9, 12),
        engineMaterial,
      );
      flame.name = side < 0 ? ENGINE_L : ENGINE_R;
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side * r * 0.5, 0, -r * ENGINE_OFFSET);
      group.add(flame);

      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(r * ENGINE_GLOW_SCALE * 1.4, 12, 8),
        glowMaterial,
      );
      glow.name = `${flame.name}-glow`;
      glow.position.set(side * r * 0.5, 0, -r * (ENGINE_OFFSET + 0.45));
      group.add(glow);
    }

    const engineLight = new THREE.PointLight(GLOW_COLOR, 1.2, r * ENGINE_LIGHT_RANGE, 2);
    engineLight.name = "triebwerks-licht";
    engineLight.position.set(0, 0, -r * (ENGINE_OFFSET + 0.5));
    group.add(engineLight);

    return group;
  }

  /**
   * Liefert die Mesh-Gruppe des Schiffs, inklusive aller Kindobjekte.
   *
   * Die Gruppe ist dieselbe Instanz, die der `SceneManager` einhaengt —
   * Aenderungen an Position/Rotation wirken sich also direkt aus.
   *
   * @returns Die Wurzelgruppe des Schiffs.
   */
  getObject(): THREE.Group {
    return this.group;
  }

  /**
   * Liefert die aktuelle Position in Szeneneinheiten.
   *
   * @returns Eine Kopie der Position (Aenderungen daran sind ohne Wirkung).
   */
  getPosition(): Vec3 {
    return { ...this.position };
  }

  /**
   * Setzt die Position des Schiffs (z. B. fuer Schnellreise oder Reset).
   *
   * @param v - Neue Position in Szeneneinheiten.
   * @throws {RangeError} Wenn eine Komponente nicht endlich ist.
   */
  setPosition(v: Vec3): void {
    this.assertVec(v, "setPosition");
    this.position = { x: v.x, y: v.y, z: v.z };
    this.group.position.set(v.x, v.y, v.z);
  }

  /**
   * Liefert die aktuelle Geschwindigkeit in Szeneneinheiten pro Sekunde.
   *
   * @returns Eine Kopie des Geschwindigkeitsvektors.
   */
  getVelocity(): Vec3 {
    return { ...this.velocity };
  }

  /**
   * Setzt die Geschwindigkeit des Schiffs (z. B. fuer Katapultmanoever).
   *
   * Die Normierung auf {@link SHIP_MAX_SPEED} greift auch hier, damit keine
   * Teleport-Geschwindigkeiten entstehen.
   *
   * @param v - Neue Geschwindigkeit in Szeneneinheiten pro Sekunde.
   * @throws {RangeError} Wenn eine Komponente nicht endlich ist.
   */
  setVelocity(v: Vec3): void {
    this.assertVec(v, "setVelocity");
    this.velocity = this.limitSpeed(v);
  }

  /**
   * Liefert die Flugrichtung (Gierwinkel) in Grad, normiert auf `[0, 360)`.
   *
   * `0` bedeutet: das Schiff zeigt entlang der positiven Z-Achse,
   * `90` entlang der positiven X-Achse.
   *
   * @returns Der Gierwinkel in Grad.
   */
  getHeadingDeg(): number {
    const deg = ((this.yawDeg % 360) + 360) % 360;
    return deg;
  }

  /**
   * Liefert den aktuellen Nickwinkel in Grad (immer innerhalb
   * `[-85, 85]`).
   *
   * @returns Der Nickwinkel in Grad.
   */
  getPitchDeg(): number {
    return this.pitchDeg;
  }

  /**
   * Liefert die Geschwindigkeit in Kilometern pro Sekunde fuer das HUD.
   *
   * @returns Die Betragsgeschwindigkeit in km/s.
   */
  getSpeedKmS(): number {
    return Math.hypot(this.velocity.x, this.velocity.y, this.velocity.z) * this.kmPerUnit;
  }

  /**
   * Liefert den aktuellen Schubanteil fuer die Schubanzeige im HUD.
   *
   * @returns Ein Wert zwischen `0` (Schub aus) und `1` (voller Schub).
   */
  getThrustLevel(): number {
    return this.thrustLevel;
  }

  /**
   * Versetzt den Ursprung des Schiffs auf die aktuelle Position.
   *
   * Nützlich, wenn die Position von aussen gesetzt wurde, damit die
   * Three.js-Gruppe und der interne Zustand nicht auseinanderlaufen.
   *
   * @returns {void}
   */
  syncFromObject(): void {
    const p = this.group.position;
    this.position = { x: p.x, y: p.y, z: p.z };
  }

  /**
   * Schwenkt und nickt das Schiff.
   *
   * Der Nickwinkel wird auf `[-85, 85]` Grad begrenzt, damit das Schiff nie
   * kopfsteht. Der Gierwinkel ist frei drehbar.
   *
   * @param deltaYaw - Gieraenderung in Grad (positiv = nach rechts drehen).
   * @param deltaPitch - Nickaenderung in Grad (positiv = Nase heben).
   * @throws {RangeError} Wenn eine der Aenderungen nicht endlich ist.
   */
  rotate(deltaYaw: number, deltaPitch: number): void {
    if (!Number.isFinite(deltaYaw) || !Number.isFinite(deltaPitch)) {
      throw new RangeError(
        `rotate: Winkel muessen endlich sein (yaw=${String(deltaYaw)}, pitch=${String(deltaPitch)}).`,
      );
    }
    this.pitchDeg = clamp(
      this.pitchDeg + deltaPitch,
      -PITCH_LIMIT_DEG,
      PITCH_LIMIT_DEG,
    );
    this.yawDeg += deltaYaw;
    this.group.rotation.y = THREE.MathUtils.degToRad(this.yawDeg);
    this.group.rotation.x = THREE.MathUtils.degToRad(this.pitchDeg);
  }

  /**
   * Setzt Gier- und Nickwinkel absolut (fuer Reset und Schnellreise).
   *
   * @param yawDeg - Gierwinkel in Grad.
   * @param pitchDeg - Nickwinkel in Grad, wird auf `[-85, 85]` geklemmt.
   * @throws {RangeError} Wenn ein Winkel nicht endlich ist.
   */
  setOrientation(yawDeg: number, pitchDeg: number): void {
    if (!Number.isFinite(yawDeg) || !Number.isFinite(pitchDeg)) {
      throw new RangeError(
        `setOrientation: Winkel muessen endlich sein (yaw=${String(yawDeg)}, pitch=${String(pitchDeg)}).`,
      );
    }
    this.pitchDeg = clamp(pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
    this.yawDeg = yawDeg;
    this.group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
    this.group.rotation.x = THREE.MathUtils.degToRad(this.pitchDeg);
  }

  /**
   * Setzt den Schub und integriert die Bewegung.
   *
   * Die drei Parameter sind Achsenwerte im Schiffskoordinatensystem
   * (`vorwaerts`, `seitlich`, `nach oben`), jeweils `-1`, `0` oder `1`
   * (Werte dazwischen ergeben proportionale Teilschuebe). Zusammen mit dem
   * Luftwiderstand ergibt das die Bewegung. Der Aufruf muss pro Bild
   * einmal erfolgen — typischerweise aus `ShipControls.update()`.
   *
   * @param forward - Schub nach vorne (positiv) bzw. rueckwaerts (negativ).
   * @param strafe - Schub nach rechts (positiv) bzw. links (negativ).
   * @param up - Schub nach oben (positiv) bzw. unten (negativ).
   * @throws {RangeError} Wenn ein Parameter nicht endlich ist.
   */
  thrust(forward: number, strafe: number, up: number): void {
    if (!Number.isFinite(forward) || !Number.isFinite(strafe) || !Number.isFinite(up)) {
      throw new RangeError(
        `thrust: Schubwerte muessen endlich sein (${String(forward)}, ${String(strafe)}, ${String(up)}).`,
      );
    }

    const accel: Vec3 = {
      x: strafe * SHIP_ACCELERATION,
      y: up * SHIP_ACCELERATION,
      z: forward * SHIP_ACCELERATION,
    };
    const world = this.toWorldDirection(accel);

    // Der Luftwiderstand wird bewusst NICHT hier angewandt, sondern
    // framerate-unabhaengig in updateMovement() — sonst haengt die
    // Daempfung von der Aufruffrequenz ab.
    this.velocity = this.limitSpeed({
      x: this.velocity.x + world.x,
      y: this.velocity.y + world.y,
      z: this.velocity.z + world.z,
    });

    this.thrustLevel = clamp(Math.hypot(forward, strafe, up), 0, 1);
  }

  /**
   * Integriert die aktuelle Geschwindigkeit ueber die Zeit.
   *
   * Der Luftwiderstand wird hier framerate-unabhaengig nachgezogen, damit
   * das Schiff auf 30 fps nicht zaeher und auf 120 fps nicht zaeh laeuft.
   *
   * @param deltaSeconds - Vergangene Zeit in Sekunden (muss >= 0 sein).
   * @throws {RangeError} Wenn `deltaSeconds` nicht endlich oder negativ ist.
   */
  updateMovement(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError(
        `updateMovement: deltaSeconds muss eine endliche Zahl >= 0 sein, ist aber ${String(deltaSeconds)}.`,
      );
    }
    if (deltaSeconds > 0) {
      const keep = Math.exp(-SHIP_DRAG_PER_SECOND * deltaSeconds);
      this.velocity = {
        x: this.velocity.x * keep,
        y: this.velocity.y * keep,
        z: this.velocity.z * keep,
      };
      this.position = {
        x: this.position.x + this.velocity.x * deltaSeconds,
        y: this.position.y + this.velocity.y * deltaSeconds,
        z: this.position.z + this.velocity.z * deltaSeconds,
      };
      this.group.position.set(this.position.x, this.position.y, this.position.z);
    }
    if (this.thrustLevel > 0) {
      this.thrustLevel = Math.max(0, this.thrustLevel - deltaSeconds);
    }
  }

  /**
   * Bremst das Schiff sofort auf Standstill.
   *
   * @returns {void}
   */
  stop(): void {
    this.velocity = { x: 0, y: 0, z: 0 };
    this.thrustLevel = 0;
  }

  /**
   * Gibt Geschwindigkeitsvektor, Geometrien, Materialien und Lichter frei.
   *
   * Nach dem Aufruf darf das Objekt nicht mehr gerendert werden.
   *
   * @returns {void}
   */
  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) {
          for (const entry of material) {
            entry.dispose();
          }
        } else {
          material.dispose();
        }
      }
      if (child instanceof THREE.Light) {
        child.dispose();
      }
    });
    this.group.clear();
    this.group.removeFromParent();
  }

  /**
   * Rechnet einen Vektor aus dem Schiffskoordinatensystem in den
   * Weltkoordinatensystem um.
   *
   * @param local - Vektor in Schiffsachsen (`z` = vorne).
   * @returns Derselbe Vektor, gedreht mit der aktuellen Schiffsorientierung.
   */
  private toWorldDirection(local: Vec3): Vec3 {
    this.group.updateMatrixWorld();
    const v = new THREE.Vector3(local.x, local.y, local.z);
    v.applyQuaternion(this.group.quaternion);
    return { x: v.x, y: v.y, z: v.z };
  }

  /**
   * Begrenzt die Geschwindigkeit auf {@link SHIP_MAX_SPEED}.
   *
   * @param v - Zu begrenzender Geschwindigkeitsvektor.
   * @returns Der Vektor, gegebenenfalls gekuerzt.
   */
  private limitSpeed(v: Vec3): Vec3 {
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed <= SHIP_MAX_SPEED || speed === 0) {
      return v;
    }
    const factor = SHIP_MAX_SPEED / speed;
    return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
  }

  /**
   * Prueft einen Vektor auf endliche Komponenten.
   *
   * @param v - Zu pruefender Vektor.
   * @param where - Name des Aufrufers fuer die Fehlermeldung.
   * @throws {RangeError} Wenn eine Komponente nicht endlich ist.
   */
  private assertVec(v: Vec3, where: string): void {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) {
      throw new RangeError(`${where}: Komponenten muessen endliche Zahlen sein.`);
    }
  }
}
