/**
 * Steuerung des Raumschiffs: Tastatur, Maus und Touch.
 *
 * Die Klasse haelt den gesamten Eingabezustand (welche Taste ist gedrueckt,
 * wohin zieht der Finger) und uebersetzt ihn pro Bild in Schub- und
 * Drehbefehle an {@link Ship} und {@link CameraFollow}.
 *
 * **Sauberes Key-Handling:** Jeder Listener wird in {@link ShipControls.attach}
 * als gebundene Methode registriert und in {@link ShipControls.detach} exakt
 * wieder entfernt — auch bei mehrfachem `attach()` gibt es keine doppelten
 * Registrierungen. Tasten werden ueber ihre `event.code` verglichen, damit
 * die deutsche Tastaturbelegung (QWERTZ) keine Rolle spielt. `keydown` ist
 * gegen Tastenwiederholung abgesichert: gehaltene Tasten wirken als Zustand,
 * Einmal-Aktionen (Reset, Schnellreise) feuern nur beim ersten Druck.
 *
 * @module controls/ShipControls
 */

import type { Vec3 } from "../core/orbital";
import type { CameraFollow } from "./CameraFollow";
import type { Ship } from "../scene/Ship";

/** Giergeschwindigkeit in Grad pro Sekunde. */
const YAW_SPEED_DEG_PER_S = 70;

/** Nickgeschwindigkeit in Grad pro Sekunde. */
const PITCH_SPEED_DEG_PER_S = 50;

/** Turbo-Faktor des Schubs (Shift). */
export const TURBO_FACTOR = 2.5;

/** Schubskala fuer die Touch-/Maussteuerung. */
const TOUCH_THRUST_SCALE = 0.8;

/** Pixel Weg, die zu vollem Touch-Schub fuehren. */
const TOUCH_FULL_THRUST_PX = 160;

/** Grad Gieren pro Pixel Mausbewegung. */
const MOUSE_YAW_DEG_PER_PX = 0.25;

/** Grad Nicken pro Pixel Mausbewegung. */
const MOUSE_PITCH_DEG_PER_PX = 0.15;

/** Maximale Kipp-Stufe der Kamera beim Mausziehen/Touch-Schwenken in Grad. */
const MAX_CAMERA_LOOK_DEG = 60;

/** Position, auf die ESC das Schiff zuruecksetzt (nahe der Sonne, X-Achse). */
const SAFE_POSITION: Vec3 = { x: 0, y: 0, z: 0 };

/** Zielkorpus fuer die Schnellreise per Taste. */
const QUICK_TRAVEL_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  KeyM: "merkur",
  KeyF: "erde",
});

/** Tasten, deren Standardaktion (Scrollen) unterdrueckt werden muss. */
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Space",
]);

/** Aktive Zeiger (Maus/Touch) fuer die Zieh-Steuerung. */
interface PointerState {
  /** Eindeutige `pointerId` des Zeigers. */
  id: number;
  /** Letzte bekannte Position in Elementkoordinaten. */
  x: number;
  /** Letzte bekannte Position in Elementkoordinaten. */
  y: number;
}

/**
 * Steuerung des Raumschiffs ueber Tastatur, Maus und Touch.
 */
export class ShipControls {
  /** Das gesteuerte Schiff. */
  private readonly ship: Ship;

  /** Die Kamera-Steuerung (fuer Orbit-Winkel und Zielwechsel). */
  private readonly camera: CameraFollow;

  /** Das Element, an dem die Listener haengen, `null` wenn nicht attached. */
  private element: HTMLElement | null = null;

  /** Aktuell gedrueckte Tasten als `event.code`-Set. */
  private readonly pressed = new Set<string>();

  /** Aktiver Zieh-Zeiger (Maus oder erster Finger), `null` wenn keiner. */
  private primary: PointerState | null = null;

  /** Zweiter Finger fuer die Zwei-Finger-Schieb-Geste, `null` wenn keiner. */
  private secondary: PointerState | null = null;

  /** Vertikale Verschiebung der Zwei-Finger-Geste in Pixeln. */
  private touchPushPx = 0;

  /** Nickwinkel der Kamera relativ zum Schiff (Grad), aus dem Ziehen. */
  private cameraPitchDeg = 0;

  /** Zuletzt an die Kamera gemeldeter Nickwinkel (fuer Deltas). */
  private lastAppliedCameraPitch = 0;

  /** Kuerzeste Distanz zwischen zwei Touchpunkten (fuer Zoom). */
  private pinchStartDistance = 0;

  /** Orbit-Distanz zu Beginn einer Pinch-Geste. */
  private pinchStartOrbit = 0;

  /** Weltpositionen der Koerper, fuer die Schnellreise. */
  private readonly quickTravelPositions = new Map<string, Vec3>();

  /**
   * Erzeugt die Steuerung.
   *
   * @param ship - Das zu steuernde Schiff.
   * @param camera - Die Kamera-Steuerung, die mitgeschaltet wird.
   */
  constructor(ship: Ship, camera: CameraFollow) {
    this.ship = ship;
    this.camera = camera;
  }

  /**
   * Registriert alle Eingabelistener an einem Element.
   *
   * Ein zweiter Aufruf mit demselben Element wird ignoriert, sodass
   * `addEventListener` nie doppelt ausgefuehrt wird.
   *
   * @param element - Das Canvas- oder Container-Element.
   * @returns {void}
   */
  attach(element: HTMLElement): void {
    if (this.element === element) {
      return;
    }
    if (this.element !== null) {
      this.detach();
    }

    this.element = element;
    element.addEventListener("keydown", this.onKeyDown);
    element.addEventListener("keyup", this.onKeyUp);
    element.addEventListener("blur", this.onBlur);
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /**
   * Entfernt alle Listener und loescht den Eingabezustand.
   *
   * Nach dem Aufruf ist die Steuerung inert; {@link ShipControls.attach}
   * kann sie erneut aktivieren.
   *
   * @returns {void}
   */
  detach(): void {
    const element = this.element;
    if (element !== null) {
      element.removeEventListener("keydown", this.onKeyDown);
      element.removeEventListener("keyup", this.onKeyUp);
      element.removeEventListener("blur", this.onBlur);
      element.removeEventListener("pointerdown", this.onPointerDown);
      element.removeEventListener("pointermove", this.onPointerMove);
      element.removeEventListener("pointerup", this.onPointerUp);
      element.removeEventListener("pointercancel", this.onPointerUp);
      element.removeEventListener("wheel", this.onWheel);
    }
    this.element = null;
    this.pressed.clear();
    this.primary = null;
    this.secondary = null;
    this.touchPushPx = 0;
    this.pinchStartDistance = 0;
  }

  /**
   * Liefert `true`, wenn die Steuerung derzeit an einem Element haengt.
   *
   * @returns Zustand der Registrierung.
   */
  isAttached(): boolean {
    return this.element !== null;
  }

  /**
   * Hinterlegt Zielpositionen fuer die Schnellreise.
   *
   * Der Integrations-Ticket (SceneManager) liefert hier die tatsaechlichen
   * Szenenpositionen der Koerper; ohne diese Zuordnung fliegen M und F
   * lediglich zum Ursprung.
   *
   * @param positions - Zuordnung von Koerper-ID (z. B. `"merkur"`) zu
   *   Weltposition in Szeneneinheiten.
   * @returns {void}
   */
  setQuickTravelPositions(positions: ReadonlyMap<string, Vec3>): void {
    this.quickTravelPositions.clear();
    for (const [id, pos] of positions) {
      this.quickTravelPositions.set(id, { ...pos });
    }
  }

  /**
   * Wertet den Eingabezustand aus und bewegt Schiff und Kamera.
   *
   * Muss einmal pro Bild aufgerufen werden.
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
    if (deltaSeconds === 0) {
      return;
    }

    // Drehen: Tastatur addiert, Maus/Touch (ein Finger) schiebt die Kamera.
    const yaw = this.axis("KeyD", "ArrowRight") - this.axis("KeyA", "ArrowLeft");
    const pitch = this.axis("KeyE") - this.axis("KeyQ");
    if (yaw !== 0) {
      this.ship.rotate(YAW_SPEED_DEG_PER_S * deltaSeconds * yaw, 0);
    }
    if (pitch !== 0) {
      this.ship.rotate(0, PITCH_SPEED_DEG_PER_S * deltaSeconds * pitch);
    }
    this.camera.setMode("follow");

    // Schub: Tastatur in Schiffsachsen, Touch ueber die Zwei-Finger-Geste.
    const forward = this.thrustAxis("KeyW", "ArrowUp") - this.thrustAxis("KeyS", "ArrowDown");
    const up = this.thrustAxis("KeyR") - this.thrustAxis("KeyC");
    const strafe = this.thrustAxis("KeyX") - this.thrustAxis("KeyZ");
    const touchForward = this.touchPushForward();
    const turbo = this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight");

    this.ship.thrust(
      (forward + touchForward) * (turbo ? TURBO_FACTOR : 1),
      strafe,
      up,
    );
    this.ship.updateMovement(deltaSeconds);
  }

  /**
   * Liefert -1, 0 oder 1 fuer eine Tastenkombination (Taste A oder Taste B).
   *
   * @param primary - Erster Tastencode.
   * @param secondary - Zweiter Tastencode (optional).
   * @returns `-1`, `0` oder `1`.
   */
  private axis(primary: string, secondary?: string): number {
    if (this.pressed.has(primary)) {
      return 1;
    }
    if (secondary !== undefined && this.pressed.has(secondary)) {
      return 1;
    }
    return 0;
  }

  /**
   * Liefert den Schubanteil (0..1) einer Tastenkombination.
   *
   * @param primary - Erster Tastencode.
   * @param secondary - Zweiter Tastencode (optional).
   * @returns `0` (nichts) bis `1` (gedrueckt).
   */
  private thrustAxis(primary: string, secondary?: string): number {
    return this.axis(primary, secondary);
  }

  /**
   * Rechnet die Touch-Schieb-Geste in einen Vorwaertsschub um.
   *
   * Zwei Finger nach oben = Schub nach vorne, nach unten = Bremsen. Der Wert
   * ist auf `[-TOUCH_FULL_THRUST_PX, +TOUCH_FULL_THRUST_PX]` begrenzt und wird
   * kontinuierlich zurueckgesetzt, damit der Schub endet, sobald die Geste
   * beendet ist.
   *
   * @returns Der Schubanteil zwischen `-1` und `1`.
   */
  private touchPushForward(): number {
    if (this.secondary === null) {
      this.touchPushPx = 0;
      return 0;
    }
    const value = Math.max(
      -TOUCH_FULL_THRUST_PX,
      Math.min(TOUCH_FULL_THRUST_PX, -this.touchPushPx),
    );
    this.touchPushPx *= 0.8;
    return value * TOUCH_THRUST_SCALE;
  }

  /**
   * Setzt das Schiff auf eine sichere Startposition zurueck.
   *
   * Position, Geschwindigkeit, Orientierung und Kamerawinkel werden
   * zurueckgesetzt — das entspricht dem Verhalten der ESC-Taste.
   *
   * @returns {void}
   */
  reset(): void {
    this.ship.setPosition(SAFE_POSITION);
    this.ship.setVelocity({ x: 0, y: 0, z: 0 });
    this.ship.setOrientation(0, 0);
    this.pressed.clear();
    this.cameraPitchDeg = 0;
    this.lastAppliedCameraPitch = 0;
    this.touchPushPx = 0;
  }

  /**
   * Springt zum angegebenen Koerper (Schnellreise).
   *
   * Ist die Position des Koerpers nicht hinterlegt, wird auf
   * {@link ShipControls.reset} zurueckgefallen.
   *
   * @param bodyId - ID des Koerpers aus `bodies.json`, z. B. `"merkur"`.
   * @returns `true`, wenn ein Ziel gefunden und angeflogen wurde.
   */
  quickTravelTo(bodyId: string): boolean {
    const target = this.quickTravelPositions.get(bodyId);
    if (target === undefined) {
      this.reset();
      return false;
    }
    this.ship.setPosition({ x: target.x, y: target.y, z: target.z });
    this.ship.setVelocity({ x: 0, y: 0, z: 0 });
    this.ship.setOrientation(0, 0);
    return true;
  }

  /**
   * Behandelt einen Tastendruck.
   *
   * @param event - Das Tastaturereignis.
   * @returns {void}
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.code)) {
      event.preventDefault();
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    // Einmal-Aktionen nur beim ersten Druck (key repeat bleibt wirkungslos).
    if (!event.repeat) {
      switch (event.code) {
        case "Space":
          this.ship.stop();
          return;
        case "Escape":
          this.reset();
          return;
        case "KeyC":
          // Schub-Stopp ist auch ueber C erreichbar (kindgerechter als ESC).
          this.ship.stop();
          return;
        default: {
          const quickTarget = QUICK_TRAVEL_TARGETS[event.code];
          if (quickTarget !== undefined) {
            this.quickTravelTo(quickTarget);
            return;
          }
        }
      }
    }

    this.pressed.add(event.code);
  };

  /**
   * Behandelt das Loslassen einer Taste.
   *
   * @param event - Das Tastaturereignis.
   * @returns {void}
   */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  /**
   * Behandelt den Verlust des Fokus: alle Tasten gelten als losgelassen.
   *
   * @returns {void}
   */
  private readonly onBlur = (): void => {
    this.pressed.clear();
    this.primary = null;
    this.secondary = null;
  };

  /**
   * Behandelt den Beginn einer Zieh-Geste (Maus oder Touch).
   *
   * @param event - Das Pointerereignis.
   * @returns {void}
   */
  private readonly onPointerDown = (event: PointerEvent): void => {
    const pointer: PointerState = { id: event.pointerId, x: event.clientX, y: event.clientY };
    if (event.pointerType === "touch") {
      if (this.primary === null) {
        this.primary = pointer;
      } else if (this.secondary === null) {
        this.secondary = pointer;
        this.pinchStartDistance = this.touchDistance();
        this.pinchStartOrbit = this.camera.getOrbitDistance();
      }
    } else if (this.primary === null) {
      this.primary = pointer;
    }
    this.element?.setPointerCapture?.(event.pointerId);
  };

  /**
   * Behandelt die Bewegung eines Zeigers.
   *
   * - ein Finger/Maus: Kamera relativ zum Schiff schwenken,
   * - zwei Finger: vertikal schieben, horizontal zoomen (Pinch).
   *
   * @param event - Das Pointerereignis.
   * @returns {void}
   */
  private readonly onPointerMove = (event: PointerEvent): void => {
    const active = this.pointerById(event.pointerId);
    if (active === null) {
      return;
    }
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    active.x = event.clientX;
    active.y = event.clientY;

    if (this.secondary !== null && event.pointerId === this.secondary.id) {
      this.touchPushPx += dy;
      const distance = this.touchDistance();
      if (this.pinchStartDistance > 0) {
        const factor = this.pinchStartDistance / Math.max(1, distance);
        this.camera.setOrbitDistance(this.pinchStartOrbit * factor);
      }
      return;
    }

    this.cameraPitchDeg = Math.max(
      -MAX_CAMERA_LOOK_DEG,
      Math.min(MAX_CAMERA_LOOK_DEG, this.cameraPitchDeg + dy * MOUSE_PITCH_DEG_PER_PX),
    );
    this.camera.addOrbitPitch(this.cameraPitchDeg - this.lastAppliedCameraPitch);
    this.lastAppliedCameraPitch = this.cameraPitchDeg;
    if (event.pointerType !== "touch") {
      // Maus: Gieren/Nicken des Schiffs, damit man direkt steuert.
      this.ship.rotate(dx * MOUSE_YAW_DEG_PER_PX, -dy * MOUSE_PITCH_DEG_PER_PX);
    }
  };

  /**
   * Behandelt das Ende einer Zieh-Geste.
   *
   * @param event - Das Pointerereignis.
   * @returns {void}
   */
  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.primary?.id === event.pointerId) {
      this.primary = null;
      this.secondary = null;
      this.touchPushPx = 0;
      this.pinchStartDistance = 0;
    } else if (this.secondary?.id === event.pointerId) {
      this.secondary = null;
      this.touchPushPx = 0;
      this.pinchStartDistance = 0;
    }
    this.element?.releasePointerCapture?.(event.pointerId);
  };

  /**
   * Behandelt das Mausrad als Zoom (Orbit-Distanz).
   *
   * @param event - Das Wheel-Ereignis.
   * @returns {void}
   */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.camera.setOrbitDistance(this.camera.getOrbitDistance() * (1 + event.deltaY * 0.001));
  };

  /**
   * Liefert den Zeiger mit der passenden `pointerId`.
   *
   * @param id - Gesuchte Zeiger-ID.
   * @returns Der Zeiger oder `null`.
   */
  private pointerById(id: number): PointerState | null {
    if (this.primary?.id === id) {
      return this.primary;
    }
    if (this.secondary?.id === id) {
      return this.secondary;
    }
    return null;
  }

  /**
   * Liefert den Abstand zwischen zwei aktiven Touchpunkten.
   *
   * @returns Pixelabstand, `0` wenn weniger als zwei Finger aktiv sind.
   */
  private touchDistance(): number {
    if (this.primary === null || this.secondary === null) {
      return 0;
    }
    return Math.hypot(
      this.secondary.x - this.primary.x,
      this.secondary.y - this.primary.y,
    );
  }
}
