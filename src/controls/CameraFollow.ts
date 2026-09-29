/**
 * Kamera-Follow: weiche Verfolgung, Orbit und freie Kamera.
 *
 * Die Klasse kennt kein DOM und kein `SceneManager` — sie bewegt nur eine
 * `THREE.PerspectiveCamera`. Das macht sie ohne WebGL testbar.
 *
 * **Weiche Uebergaenge:** Position und Blickziel werden per
 * {@link https://threejs.org/docs/#api/en/math/MathUtils MathUtils.damp}
 * (exponentielle Glaettung) nachgefuehrt. Bei `prefers-reduced-motion: reduce`
 * wird stattdessen direkt gesetzt — keine Animation, aber die Kamera bleibt
 * korrekt ausgerichtet.
 *
 * @module controls/CameraFollow
 */

import * as THREE from "three";

/** Die drei Betriebsarten der Kamera. */
export type CameraMode = "follow" | "free" | "orbit";

/** Reihenfolge, in der {@link CameraFollow.toggleMode} durchschaltet. */
const MODE_CYCLE: readonly CameraMode[] = ["follow", "orbit", "free"] as const;

/** Glaettungsfaktor fuer die Kameraposition (hoeher = weicher/trager). */
const POSITION_DAMPING = 4.0;

/** Glaettungsfaktor fuer das Blickziel (hoeher = weicher/trager). */
const TARGET_DAMPING = 6.0;

/** Winkelgeschwindigkeit des automatischen Orbit in Radiant pro Sekunde. */
const ORBIT_SPEED = 0.35;

/** Abstand hinter dem Schiff, relativ zur Rumpfgroesse des Ziels. */
const FOLLOW_DISTANCE = 6.0;

/** Hoehe der Kamera ueber dem Schiff, relativ zur Rumpfgroesse des Ziels. */
const FOLLOW_HEIGHT = 2.2;

/** Standarddistanz des Orbit-Modus in Szeneneinheiten. */
const DEFAULT_ORBIT_DISTANCE = 30;

/** Kleinster erlaubter Orbit-Abstand in Szeneneinheiten. */
const MIN_ORBIT_DISTANCE = 2;

/** Groesster erlaubter Orbit-Auslenkwinkel ueber/unter der Ebene in Grad. */
const MAX_ORBIT_PITCH_DEG = 85;

/**
 * Media-Query, mit der die reduzierte Bewegung abgefragt wird.
 *
 * Bewusst als Modulkonstante: im Test kann sie per `vi.stubGlobal` bzw. durch
 * Ersetzen von `window.matchMedia` simuliert werden.
 */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Prueft, ob der Nutzer reduzierte Bewegung gewaehlt hat.
 *
 * Fehlende `matchMedia` (z. B. in sehr alten Test-Umgebungen) wird als
 * "keine reduzierte Bewegung" gewertet, damit die Kamera normal laeuft.
 *
 * @returns `true`, wenn Animationen vermieden werden sollen.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Kamera-Follow mit drei Betriebsarten.
 */
export class CameraFollow {
  /** Die gesteuerte Kamera. */
  private readonly camera: THREE.PerspectiveCamera;

  /** Aktuell verfolgtes Objekt, `null` = kein Ziel. */
  private target: THREE.Object3D | null = null;

  /** Aktive Betriebsart. */
  private mode: CameraMode = "follow";

  /** Abstand des Orbit-Modus in Szeneneinheiten. */
  private orbitDistance = DEFAULT_ORBIT_DISTANCE;

  /** Aktueller Orbit-Winkel in Radiant (fortlaufend weitergerechnet). */
  private orbitAngle = 0;

  /** Aktueller Orbit-Nickwinkel in Grad. */
  private orbitPitchDeg = 20;

  /** Gewuenschte Kameraposition (Ergebnis des jeweiligen Modus). */
  private readonly desiredPosition = new THREE.Vector3();

  /** Gewuenschtes Blickziel. */
  private readonly desiredLookAt = new THREE.Vector3();

  /** Aktuell geglaettetes Blickziel. */
  private readonly currentLookAt = new THREE.Vector3();

  /** `true`, solange die Kamera initial sauber ausgerichtet werden muss. */
  private needsSnap = true;

  /**
   * Erzeugt die Kamera-Steuerung.
   *
   * @param camera - Die zu steuernde Perspektivkamera.
   */
  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  /**
   * Setzt (oder entfernt) das Verfolgungsziel.
   *
   * Wird `null` uebergeben, bleibt die Kamera in der aktuellen Position
   * stehen (Modus `free`).
   *
   * @param object - Objekt, dessen Weltposition verfolgt wird, oder `null`.
   * @returns {void}
   */
  setTarget(object: THREE.Object3D | null): void {
    this.target = object;
  }

  /**
   * Wechselt die Betriebsart der Kamera.
   *
   * @param mode - Neue Betriebsart.
   * @returns {void}
   */
  setMode(mode: CameraMode): void {
    this.mode = mode;
  }

  /**
   * Liefert die aktive Betriebsart.
   *
   * @returns Die aktuelle Betriebsart.
   */
  getMode(): CameraMode {
    return this.mode;
  }

  /**
   * Setzt den Abstand des Orbit-Modus.
   *
   * @param d - Abstand zum Ziel in Szeneneinheiten; wird auf
   *   `[MIN_ORBIT_DISTANCE, 10 000]` geklemmt.
   * @throws {RangeError} Wenn `d` nicht endlich ist.
   */
  setOrbitDistance(d: number): void {
    if (!Number.isFinite(d)) {
      throw new RangeError(`setOrbitDistance: d muss endlich sein, ist aber ${String(d)}.`);
    }
    this.orbitDistance = Math.min(10_000, Math.max(MIN_ORBIT_DISTANCE, d));
  }

  /**
   * Liefert den aktuellen Orbit-Abstand in Szeneneinheiten.
   *
   * @returns Der Orbit-Abstand.
   */
  getOrbitDistance(): number {
    return this.orbitDistance;
  }

  /**
   * Lenkt den Orbit-Blickpunkt vertikal (z. B. per Mausrad).
   *
   * @param deltaDeg - Aenderung des Nickwinkels in Grad.
   * @throws {RangeError} Wenn `deltaDeg` nicht endlich ist.
   */
  addOrbitPitch(deltaDeg: number): void {
    if (!Number.isFinite(deltaDeg)) {
      throw new RangeError(`addOrbitPitch: deltaDeg muss endlich sein, ist aber ${String(deltaDeg)}.`);
    }
    this.orbitPitchDeg = Math.min(
      MAX_ORBIT_PITCH_DEG,
      Math.max(-MAX_ORBIT_PITCH_DEG, this.orbitPitchDeg + deltaDeg),
    );
  }

  /**
   * Schaltet zwischen `follow`, `orbit` und `free` weiter.
   *
   * @returns Die jetzt aktive Betriebsart.
   */
  toggleMode(): CameraMode {
    const index = MODE_CYCLE.indexOf(this.mode);
    const next = MODE_CYCLE[(index + 1) % MODE_CYCLE.length] ?? "follow";
    this.mode = next;
    return next;
  }

  /**
   * Bewegt die Kamera um eine Zeitaenderung.
   *
   * - `follow`: Kamera schwebt weich hinter dem Schiff, ausgerichtet auf
   *   dessen Nase, und folgt der Bewegung mit exponentieller Glaettung.
   * - `orbit`: automatische Umkreisung des Ziels, ebenfalls weich.
   * - `free`: keine automatische Bewegung.
   *
   * Bei `prefers-reduced-motion: reduce` wird ohne Glaettung direkt
   * gesetzt (keine Animation).
   *
   * @param deltaSeconds - Vergangene Zeit in Sekunden (muss >= 0 sein).
   * @throws {RangeError} Wenn `deltaSeconds` nicht endlich oder negativ ist.
   */
  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError(
        `update: deltaSeconds muss eine endliche Zahl >= 0 sein, ist aber ${String(deltaSeconds)}.`,
      );
    }
    if (this.mode === "free" || this.target === null) {
      return;
    }

    this.target.updateMatrixWorld();
    const targetPos = new THREE.Vector3();
    this.target.getWorldPosition(targetPos);

    if (this.mode === "follow") {
      this.computeFollow(this.target, targetPos);
    } else {
      this.computeOrbit(targetPos, deltaSeconds);
    }

    const reduced = prefersReducedMotion();
    if (reduced || this.needsSnap) {
      this.camera.position.copy(this.desiredPosition);
      this.currentLookAt.copy(this.desiredLookAt);
      this.needsSnap = false;
    } else {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.desiredPosition.x,
        POSITION_DAMPING,
        deltaSeconds,
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.desiredPosition.y,
        POSITION_DAMPING,
        deltaSeconds,
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.desiredPosition.z,
        POSITION_DAMPING,
        deltaSeconds,
      );
      this.currentLookAt.x = THREE.MathUtils.damp(
        this.currentLookAt.x,
        this.desiredLookAt.x,
        TARGET_DAMPING,
        deltaSeconds,
      );
      this.currentLookAt.y = THREE.MathUtils.damp(
        this.currentLookAt.y,
        this.desiredLookAt.y,
        TARGET_DAMPING,
        deltaSeconds,
      );
      this.currentLookAt.z = THREE.MathUtils.damp(
        this.currentLookAt.z,
        this.desiredLookAt.z,
        TARGET_DAMPING,
        deltaSeconds,
      );
    }

    this.camera.lookAt(this.currentLookAt);
  }

  /**
   * Berechnet Wunschposition und Blickziel fuer den Follow-Modus.
   *
   * Die Kamera sitzt hinter dem Schiff (entgegen seiner Blickrichtung),
   * leicht ueber der Flugebene, und schaut auf die Nase.
   *
   * @param target - Das verfolgte Objekt (darf nicht `null` sein).
   * @param targetPos - Weltposition des Ziels.
   * @returns {void}
   */
  private computeFollow(target: THREE.Object3D, targetPos: THREE.Vector3): void {
    // Skalierung der Kameraabstaende mit der Zielgroesse, damit die
    // Sicht auch bei einem 6-Einheiten-Planeten brauchbar bleibt.
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    const distance = Math.max(2, extent * FOLLOW_DISTANCE);
    const height = Math.max(1, extent * FOLLOW_HEIGHT);

    // Blickrichtung des Schiffs (nur horizontal, damit die Kamera nicht
    // bei jedem Nicken durch die Erde faehrt).
    target.getWorldQuaternion(ORIENTATION);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(ORIENTATION);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) {
      forward.set(0, 0, 1);
    }
    forward.normalize();

    this.desiredPosition
      .copy(targetPos)
      .addScaledVector(forward, -distance)
      .addScaledVector(UP, height);
    this.desiredLookAt.copy(targetPos);
  }

  /**
   * Berechnet Wunschposition und Blickziel fuer den Orbit-Modus.
   *
   * @param targetPos - Weltposition des Ziels.
   * @param deltaSeconds - Vergangene Zeit in Sekunden.
   * @returns {void}
   */
  private computeOrbit(targetPos: THREE.Vector3, deltaSeconds: number): void {
    if (!prefersReducedMotion()) {
      this.orbitAngle += ORBIT_SPEED * deltaSeconds;
    }
    const pitchRad = THREE.MathUtils.degToRad(this.orbitPitchDeg);
    const horizontal = this.orbitDistance * Math.cos(pitchRad);
    this.desiredPosition.set(
      targetPos.x + horizontal * Math.cos(this.orbitAngle),
      targetPos.y + this.orbitDistance * Math.sin(pitchRad),
      targetPos.z + horizontal * Math.sin(this.orbitAngle),
    );
    this.desiredLookAt.copy(targetPos);
  }

  /**
   * Loest die Kamera-Steuerung und stellt die Kamera auf ihren
   * Ausgangszustand zurueck (kein Ziel, Modus `follow`).
   *
   * @returns {void}
   */
  dispose(): void {
    this.target = null;
    this.mode = "follow";
    this.orbitDistance = DEFAULT_ORBIT_DISTANCE;
    this.orbitAngle = 0;
    this.orbitPitchDeg = 20;
    this.needsSnap = true;
  }
}

/** Welt-Hochachse als wiederverwendeter Vektor. */
const UP = new THREE.Vector3(0, 1, 0);

/** Wiederverwendete Quaternion fuer die Schiffsorientierung. */
const ORIENTATION = new THREE.Quaternion();
