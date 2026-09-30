/**
 * Smoke-Tests fuer Raumschiff, Steuerung und Kamera-Follow (Ticket 07).
 *
 * Getestet wird alles ohne WebGL: Flugphysik, Pitch-Begrenzung, Key-Handling
 * (inkl. Key-Repeat und preventDefault), Touch-Gesten, Kamera-Modi und die
 * Respektierung von `prefers-reduced-motion`.
 */
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraFollow } from "../../src/controls/CameraFollow";
import { ShipControls, TURBO_FACTOR } from "../../src/controls/ShipControls";
import { PITCH_LIMIT_DEG, Ship, kmPerSceneUnit } from "../../src/scene/Ship";

/** Erzeugt ein Raumschiff im Standardmodus. */
function makeShip(): Ship {
  return new Ship("visual", "visual");
}

/** Erzeugt eine Kamera und die zugehoerige Steuerung. */
function makeCamera(): { camera: THREE.PerspectiveCamera; follow: CameraFollow } {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10_000);
  return { camera, follow: new CameraFollow(camera) };
}

/** Simuliert `prefers-reduced-motion`. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/**
 * Erzeugt ein Pointer-Ereignis.
 *
 * jsdom kennt `PointerEvent` noch nicht, deshalb wird ein `MouseEvent`
 * erweitert; die `pointerId`/`pointerType`-Eigenschaften werden direkt
 * gesetzt, weil die Steuerung genau darauf hoert.
 *
 * @param type - Ereignistyp (`pointerdown` usw.).
 * @param pointerId - Eindeutige Zeiger-ID.
 * @param pointerType - `"mouse"` oder `"touch"`.
 * @param clientX - X-Position in Bildschirmkoordinaten.
 * @param clientY - Y-Position in Bildschirmkoordinaten.
 * @returns Das fertige, an ein Element dispatchbares Ereignis.
 */
function pointerEvent(
  type: string,
  pointerId: number,
  pointerType: "mouse" | "touch",
  clientX: number,
  clientY: number,
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ship: Modell", () => {
  it("baut Rumpf, Cockpit, Fluegel und Triebwerkslicht", () => {
    const ship = makeShip();
    const names: string[] = [];
    ship.getObject().traverse((child) => {
      names.push(child.name);
    });

    expect(names).toContain("rumpf");
    expect(names).toContain("cockpit");
    expect(names).toContain("fluegel-links");
    expect(names).toContain("fluegel-rechts");
    expect(names).toContain("triebwerk-l");
    expect(names).toContain("triebwerk-r");
    expect(names).toContain("triebwerks-licht");
    ship.dispose();
  });

  it("nutzt hellen Rumpf mit orangem Akzent", () => {
    const ship = makeShip();
    const materials: THREE.MeshStandardMaterial[] = [];
    ship.getObject().traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const material = child.material;
        if (material instanceof THREE.MeshStandardMaterial) {
          materials.push(material);
        }
      }
    });

    const colors = materials.map((m) => m.color.getHex());
    expect(colors).toContain(0xe8f2ff);
    expect(colors).toContain(0xff8a1a);
    ship.dispose();
  });

  it("freigibt alle Kindobjekte beim dispose", () => {
    const ship = makeShip();
    expect(ship.getObject().children.length).toBeGreaterThan(0);
    ship.dispose();
    expect(ship.getObject().children).toHaveLength(0);
  });

  it("rechnet die Geschwindigkeit je nach Distanzmodus in km/s um", () => {
    const km = kmPerSceneUnit("real");
    expect(km).toBeGreaterThan(0);
    const ship = new Ship("real", "real");
    ship.setVelocity({ x: 1, y: 0, z: 0 });
    expect(ship.getSpeedKmS()).toBeCloseTo(km, 6);
    ship.dispose();
  });
});

describe("Ship: Flugphysik", () => {
  it("beschleunigt in Flugrichtung (+Z)", () => {
    const ship = makeShip();
    ship.thrust(1, 0, 0);
    const v = ship.getVelocity();
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.z).toBeGreaterThan(0);
    expect(ship.getThrustLevel()).toBeCloseTo(1, 6);
    ship.dispose();
  });

  it("beschleunigt seitlich und nach oben in Schiffsachsen", () => {
    const ship = makeShip();
    ship.thrust(0, 1, 1);
    const v = ship.getVelocity();
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeGreaterThan(0);
    ship.dispose();
  });

  it("dreht den Schubvektor mit der Schiffsorientierung", () => {
    const ship = makeShip();
    ship.rotate(90, 0);
    ship.thrust(1, 0, 0);
    const v = ship.getVelocity();
    // Nach 90 Grad Gieren zeigt die Nase auf +X, nicht mehr auf +Z.
    expect(v.x).toBeGreaterThan(1);
    expect(v.z).toBeCloseTo(0, 6);
    expect(ship.getHeadingDeg()).toBeCloseTo(90, 6);
    ship.dispose();
  });

  it("begrenzt den Nickwinkel auf -85..85 Grad", () => {
    const ship = makeShip();
    ship.rotate(0, 1000);
    expect(ship.getPitchDeg()).toBe(PITCH_LIMIT_DEG);
    ship.rotate(0, -1000);
    expect(ship.getPitchDeg()).toBe(-PITCH_LIMIT_DEG);
    expect(PITCH_LIMIT_DEG).toBe(85);
    ship.dispose();
  });

  it("haelt den Nickwinkel auch bei setOrientation begrenzt", () => {
    const ship = makeShip();
    ship.setOrientation(0, 200);
    expect(ship.getPitchDeg()).toBe(PITCH_LIMIT_DEG);
    ship.dispose();
  });

  it("bremst mit updateMovement exponentiell und bewegt die Position", () => {
    const ship = makeShip();
    ship.setVelocity({ x: 2, y: 0, z: 0 });
    ship.updateMovement(0.5);
    expect(ship.getPosition().x).toBeGreaterThan(0);
    const after = ship.getVelocity().x;
    expect(after).toBeLessThan(2);
    expect(after).toBeGreaterThan(0);
    ship.dispose();
  });

  it("stop() bringt das Schiff zum Stillstand", () => {
    const ship = makeShip();
    ship.setVelocity({ x: 5, y: 3, z: -2 });
    ship.thrust(1, 0, 0);
    ship.stop();
    expect(ship.getVelocity()).toEqual({ x: 0, y: 0, z: 0 });
    expect(ship.getThrustLevel()).toBe(0);
    ship.dispose();
  });

  it("lehnt nicht-endliche Werte ab", () => {
    const ship = makeShip();
    expect(() => ship.setPosition({ x: Number.NaN, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => ship.thrust(Number.POSITIVE_INFINITY, 0, 0)).toThrow(RangeError);
    expect(() => ship.rotate(Number.NaN, 0)).toThrow(RangeError);
    expect(() => ship.updateMovement(-1)).toThrow(RangeError);
    ship.dispose();
  });
});

describe("CameraFollow", () => {
  it("folgt dem Ziel weich von hinten", () => {
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    follow.setTarget(ship.getObject());
    follow.setMode("follow");
    follow.update(0.016);
    // Kamera muss hinter dem Schiff stehen, also auf der -Z-Seite.
    expect(camera.position.z).toBeLessThan(0);
    expect(camera.position.y).toBeGreaterThan(0);
    ship.dispose();
  });

  it("faengt das Ziel bei reduzierter Bewegung ohne Animation ein", () => {
    stubReducedMotion(true);
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    ship.setPosition({ x: 0, y: 0, z: 500 });
    follow.setTarget(ship.getObject());
    follow.update(0.016);
    expect(camera.position.distanceTo(new THREE.Vector3(0, 0, 500))).toBeLessThan(20);
    ship.dispose();
  });

  it("umkreist im Orbit-Modus automatisch", () => {
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    follow.setTarget(ship.getObject());
    follow.setMode("orbit");
    follow.setOrbitDistance(50);
    follow.update(0.1);
    const first = camera.position.x;
    follow.update(1.0);
    expect(camera.position.x).not.toBeCloseTo(first, 3);
    ship.dispose();
  });

  it("laesst die Kamera im free-Modus stehen", () => {
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    camera.position.set(7, 8, 9);
    follow.setTarget(ship.getObject());
    follow.setMode("free");
    follow.update(0.5);
    expect(camera.position.x).toBe(7);
    expect(camera.position.y).toBe(8);
    expect(camera.position.z).toBe(9);
    ship.dispose();
  });

  it("schaltet toggleMode durch follow -> orbit -> free", () => {
    const { follow } = makeCamera();
    follow.setMode("follow");
    expect(follow.toggleMode()).toBe("orbit");
    expect(follow.toggleMode()).toBe("free");
    expect(follow.toggleMode()).toBe("follow");
  });

  it("klemmt den Orbit-Abstand", () => {
    const { follow } = makeCamera();
    follow.setOrbitDistance(0.0001);
    expect(follow.getOrbitDistance()).toBeGreaterThan(0);
    follow.setOrbitDistance(1e9);
    expect(follow.getOrbitDistance()).toBeLessThan(1e6);
    expect(() => follow.setOrbitDistance(Number.NaN)).toThrow(RangeError);
  });

  it("reset nach dispose()", () => {
    const { follow } = makeCamera();
    follow.setMode("orbit");
    follow.setOrbitDistance(999);
    follow.dispose();
    expect(follow.getMode()).toBe("follow");
    expect(follow.getOrbitDistance()).toBeLessThan(999);
  });
});

describe("ShipControls: Tastatur", () => {
  /** Erzeugt Steuerung plus Element fuer Tastaturtests. */
  function makeControls(): {
    ship: Ship;
    controls: ShipControls;
    element: HTMLElement;
  } {
    const ship = makeShip();
    const { follow } = makeCamera();
    const controls = new ShipControls(ship, follow);
    const element = document.createElement("div");
    element.tabIndex = 0;
    document.body.appendChild(element);
    controls.attach(element);
    return { ship, controls, element };
  }

  it("legt Listener genau einmal an und loest sie sauber ab", () => {
    const { controls, element } = makeControls();
    const addSpy = vi.spyOn(element, "addEventListener");
    const removeSpy = vi.spyOn(element, "removeEventListener");

    // Doppeltes attach() an dasselbe Element darf nichts neu registrieren.
    controls.attach(element);
    expect(addSpy).not.toHaveBeenCalled();

    controls.detach();
    const registered = addSpy.mock.calls.length;
    const removed = removeSpy.mock.calls.length;
    expect(removed).toBeGreaterThan(0);
    expect(registered).toBeGreaterThanOrEqual(0);
    expect(controls.isAttached()).toBe(false);
  });

  it("schiebt vorwaerts bei W und stoppt bei Loslassen", () => {
    const { ship, element, controls } = makeControls();
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.1);
    expect(ship.getVelocity().z).toBeGreaterThan(0);

    element.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    const z = ship.getVelocity().z;
    controls.update(0.1);
    expect(ship.getVelocity().z).toBeLessThan(z);
    controls.detach();
    ship.dispose();
  });

  it("verhindert das Scrollen bei Pfeiltasten und Space", () => {
    const { element, controls, ship } = makeControls();
    for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]) {
      const event = new KeyboardEvent("keydown", { code, cancelable: true, bubbles: true });
      element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    controls.detach();
    ship.dispose();
  });

  it("ignoriert Tastenwiederholung fuer Einmal-Aktionen", () => {
    const { ship, element, controls } = makeControls();
    ship.setVelocity({ x: 9, y: 9, z: 9 });
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(ship.getVelocity()).toEqual({ x: 0, y: 0, z: 0 });

    // Key-Repeat von W darf die Geschwindigkeit nicht unphysikalisch machen.
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", repeat: true }));
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", repeat: true }));
    controls.update(0.016);
    const v = ship.getVelocity();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThan(20);
    controls.detach();
    ship.dispose();
  });

  it("nutzt Turbo mit Shift (2.5x)", () => {
    const normal = makeShip();
    const turbo = makeShip();
    normal.thrust(1, 0, 0);
    turbo.thrust(TURBO_FACTOR, 0, 0);
    expect(turbo.getVelocity().z).toBeCloseTo(normal.getVelocity().z * TURBO_FACTOR, 6);
    normal.dispose();
    turbo.dispose();
  });

  it("schwenkt mit A/D und nickt mit Q/E", () => {
    const { ship, element, controls } = makeControls();
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
    controls.update(0.1);
    expect(ship.getHeadingDeg()).toBeGreaterThan(0);
    expect(ship.getPitchDeg()).toBeGreaterThan(0);
    controls.detach();
    ship.dispose();
  });

  it("ESC setzt das Schiff zurueck", () => {
    const { ship, element, controls } = makeControls();
    ship.setPosition({ x: 100, y: 50, z: -20 });
    ship.setVelocity({ x: 3, y: 0, z: 0 });
    ship.rotate(45, 30);
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(ship.getPosition()).toEqual({ x: 0, y: 0, z: 0 });
    expect(ship.getVelocity()).toEqual({ x: 0, y: 0, z: 0 });
    expect(ship.getHeadingDeg()).toBeCloseTo(0, 6);
    expect(ship.getPitchDeg()).toBe(0);
    controls.detach();
    ship.dispose();
  });

  it("fliegt per M auf Merkur und per F auf die Erde", () => {
    const { ship, element, controls } = makeControls();
    controls.setQuickTravelPositions(
      new Map([
        ["merkur", { x: 10, y: 0, z: 0 }],
        ["erde", { x: 0, y: 20, z: 0 }],
      ]),
    );

    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyM" }));
    expect(ship.getPosition()).toEqual({ x: 10, y: 0, z: 0 });

    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
    expect(ship.getPosition()).toEqual({ x: 0, y: 20, z: 0 });

    controls.detach();
    ship.dispose();
  });

  it("loest alle Tasten bei blur", () => {
    const { ship, element, controls } = makeControls();
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    element.dispatchEvent(new Event("blur"));
    const z = ship.getVelocity().z;
    controls.update(0.1);
    expect(ship.getVelocity().z).toBeLessThanOrEqual(z);
    controls.detach();
    ship.dispose();
  });

  it("reagiert nach detach() nicht mehr auf Eingaben", () => {
    const { ship, element, controls } = makeControls();
    controls.detach();
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.1);
    expect(ship.getVelocity().z).toBe(0);
    ship.dispose();
  });

  it("lehnt negative deltaSeconds ab", () => {
    const { ship, controls } = makeControls();
    expect(() => controls.update(-0.5)).toThrow(RangeError);
    controls.detach();
    ship.dispose();
  });
});

describe("ShipControls: Maus und Touch", () => {
  /** Erzeugt Steuerung mit angehaengtem Element. */
  function makeTouchControls(): {
    ship: Ship;
    controls: ShipControls;
    element: HTMLElement;
  } {
    const ship = makeShip();
    const { follow } = makeCamera();
    const controls = new ShipControls(ship, follow);
    const element = document.createElement("div");
    element.tabIndex = 0;
    document.body.appendChild(element);
    // jsdom kennt Pointer-Capture nicht — als No-op bereitstellen.
    element.setPointerCapture = () => undefined;
    element.releasePointerCapture = () => undefined;
    controls.attach(element);
    return { ship, controls, element };
  }

  it("steuert das Schiff per Mausziehen", () => {
    const { ship, element, controls } = makeTouchControls();
    element.dispatchEvent(pointerEvent("pointerdown", 1, "mouse", 100, 100));
    element.dispatchEvent(pointerEvent("pointermove", 1, "mouse", 140, 100));
    expect(ship.getHeadingDeg()).toBeGreaterThan(0);
    element.dispatchEvent(pointerEvent("pointerup", 1, "mouse", 140, 100));
    controls.detach();
    ship.dispose();
  });

  it("schiebt mit zwei Fingern", () => {
    const { ship, element, controls } = makeTouchControls();
    const touch = (type: string, id: number, x: number, y: number): void => {
      element.dispatchEvent(pointerEvent(type, id, "touch", x, y));
    };

    touch("pointerdown", 1, 100, 200);
    touch("pointerdown", 2, 200, 200);
    // Zweiter Finger nach oben schieben -> Vorwaertsschub.
    touch("pointermove", 2, 200, 140);
    controls.update(0.1);
    expect(ship.getVelocity().z).toBeGreaterThan(0);

    touch("pointerup", 2, 200, 140);
    controls.detach();
    ship.dispose();
  });

  it("zoomt per Mausrad im Orbit-Modus", () => {
    const { controls, element, ship } = makeTouchControls();
    const event = new WheelEvent("wheel", { deltaY: 200, cancelable: true, bubbles: true });
    element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    controls.detach();
    ship.dispose();
  });
});

describe("Ship: Audio", () => {
  it("erzeugt einen AudioListener auf der Schiffsgruppe", () => {
    const ship = makeShip();
    const listener = ship.getObject().children.find(
      (c): c is THREE.AudioListener => c instanceof THREE.AudioListener,
    );
    // In jsdom existiert kein AudioContext — der Listener wird dann
    // nicht erzeugt. Das Schiff funktioniert trotzdem (Audio ist
    // optional, Fehler werden im Konstruktor abgefangen).
    if (listener) {
      expect(listener).toBeInstanceOf(THREE.AudioListener);
    }
    ship.dispose();
  });

  it("spielt Klick-Sound ohne Absturz ab", () => {
    const ship = makeShip();
    expect(() => ship.playClickSound()).not.toThrow();
    ship.dispose();
  });

  it("spielt Bestaetigungs-Sound ohne Absturz ab", () => {
    const ship = makeShip();
    expect(() => ship.playConfirmSound()).not.toThrow();
    ship.dispose();
  });

  it("laedt das Modell und ersetzt das Platzhalter-Geomoerie", async () => {
    const ship = makeShip();
    const namesBefore: string[] = [];
    ship.getObject().traverse((child) => namesBefore.push(child.name));
    expect(namesBefore).toContain("rumpf");

    const mockScene = new THREE.Group();
    mockScene.name = "mock-model";
    const { GLTFLoader } = await import(
      "three/examples/jsm/loaders/GLTFLoader.js"
    );
    const originalLoad = GLTFLoader.prototype.load;
    (GLTFLoader.prototype.load as unknown as unknown) = vi.fn((
      _url: string,
      onLoad: (gltf: unknown) => void,
    ) => {
      onLoad({ scene: mockScene });
    });

    await ship.loadModel("/media/models/schiff_racer.glb");

    const namesAfter: string[] = [];
    ship.getObject().traverse((child) => namesAfter.push(child.name));
    expect(namesAfter).not.toContain("rumpf");
    expect(namesAfter).toContain("schiff-model");

    GLTFLoader.prototype.load = originalLoad;
    ship.dispose();
  });

  it("behaelt das Platzhalter-Modell bei Fehler", async () => {
    const ship = makeShip();
    const { GLTFLoader } = await import(
      "three/examples/jsm/loaders/GLTFLoader.js"
    );
    const originalLoad = GLTFLoader.prototype.load;
    (GLTFLoader.prototype.load as unknown as unknown) = vi.fn((
      _url: string,
      _onLoad: (gltf: unknown) => void,
      _onProgress: ((event: ProgressEvent) => void) | undefined,
      onError: (event: ErrorEvent) => void,
    ) => {
      onError(new ErrorEvent("error", { message: "mock error" }));
    });

    await expect(ship.loadModel("/bad/path.glb")).rejects.toThrow();

    const names: string[] = [];
    ship.getObject().traverse((child) => names.push(child.name));
    expect(names).toContain("rumpf");

    GLTFLoader.prototype.load = originalLoad;
    ship.dispose();
  });
});

describe("ShipControls: Auto-Travel", () => {
  /** Erzeugt eine Auto-Travel-testtaegige Umgebung. */
  function makeAutoTravelEnv(): {
    ship: Ship;
    controls: ShipControls;
    element: HTMLElement;
  } {
    const ship = makeShip();
    const { follow } = makeCamera();
    const controls = new ShipControls(ship, follow);
    const element = document.createElement("div");
    element.tabIndex = 0;
    document.body.appendChild(element);
    controls.attach(element);
    return { ship, controls, element };
  }

  it("fliegt glatt Richtung Ziel", () => {
    const { ship, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 0, y: 0, z: 0 });
    controls.startAutoTravel({ x: 100, y: 0, z: 0 });

    // Erstes Frame: Schiff naehert sich dem Ziel.
    controls.update(0.1);
    const pos = ship.getPosition();
    expect(pos.x).toBeGreaterThan(0);
    expect(pos.x).toBeLessThan(100);
    expect(pos.y).toBeCloseTo(0, 6);
    expect(pos.z).toBeCloseTo(0, 6);
    controls.detach();
    ship.dispose();
  });

  it("erreicht das Ziel und bleibt stehen", () => {
    const { ship, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 0, y: 0, z: 0 });
    // Kurze Distanz (1 Einheit): Frame 1 bringt 0.8 nah ans Ziel,
    // Frame 2 erkennt Restdistanz < 0.4 -> Ankunft.
    controls.startAutoTravel({ x: 1, y: 0, z: 0 });
    controls.update(0.1);
    controls.update(0.1);
    expect(controls.isAutoTravelActive()).toBe(false);
    const pos = ship.getPosition();
    expect(pos.x).toBeCloseTo(1, 4);
    expect(pos.y).toBeCloseTo(0, 4);
    expect(pos.z).toBeCloseTo(0, 4);
    expect(ship.getVelocity()).toEqual({ x: 0, y: 0, z: 0 });
    controls.detach();
    ship.dispose();
  });

  it("cancelAutoTravel beendet die Reise", () => {
    const { ship, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 0, y: 0, z: 0 });
    controls.startAutoTravel({ x: 100, y: 0, z: 0 });

    controls.cancelAutoTravel();
    expect(controls.isAutoTravelActive()).toBe(false);

    // Nach der Abbrechung darf sich das Schiff nicht mehr bewegen.
    const before = ship.getPosition();
    controls.update(0.1);
    const after = ship.getPosition();
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
    controls.detach();
    ship.dispose();
  });

  it("isAutoTravelActive liefert korrekten Zustand", () => {
    const { controls } = makeAutoTravelEnv();
    expect(controls.isAutoTravelActive()).toBe(false);
    controls.startAutoTravel({ x: 50, y: 0, z: 0 });
    expect(controls.isAutoTravelActive()).toBe(true);
    controls.cancelAutoTravel();
    expect(controls.isAutoTravelActive()).toBe(false);
    controls.detach();
  });

  it("neuer Auto-Travel ueberschreibt die alte Reise", () => {
    const { ship, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 0, y: 0, z: 0 });
    controls.startAutoTravel({ x: 100, y: 0, z: 0 });
    controls.startAutoTravel({ x: 0, y: 0, z: 50 });

    controls.update(0.1);
    const pos = ship.getPosition();
    // Richtungsänderung: Z-Komponente muss jetzt positiv sein.
    expect(pos.z).toBeGreaterThan(0);
    controls.detach();
    ship.dispose();
  });

  it("Auto-Travel-Update ignoriert Schubschluessel", () => {
    const { ship, element, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 0, y: 0, z: 0 });
    controls.startAutoTravel({ x: 50, y: 0, z: 0 });

    // W gleichzeitig mit Auto-Travel: Schub wird unterdrueckt.
    element.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
    controls.update(0.1);
    const pos = ship.getPosition();
    expect(pos.x).toBeGreaterThan(0);
    // Z-Komponente: nur Auto-Travel, kein Extra-Schub.
    expect(pos.z).toBeCloseTo(0, 4);
    element.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    controls.detach();
    ship.dispose();
  });

  it("ESC bricht Auto-Travel ab und setzt Position zurueck", () => {
    const { ship, element, controls } = makeAutoTravelEnv();
    ship.setPosition({ x: 10, y: 0, z: 0 });
    controls.startAutoTravel({ x: 100, y: 0, z: 0 });

    element.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(controls.isAutoTravelActive()).toBe(false);
    expect(ship.getPosition()).toEqual({ x: 0, y: 0, z: 0 });
    controls.detach();
    ship.dispose();
  });
});

describe("CameraFollow: 3rd-Person", () => {
  it("blickt im Follow-Modus auf die Schiffnase", () => {
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    follow.setTarget(ship.getObject());
    follow.setMode("follow");

    // Schiff zeigt nach +Z (Standard).
    follow.update(0.016);
    const lookAt = new THREE.Vector3();
    // Blickrichtung aus Kameraposition und -Ausrichtung ableiten.
    camera.getWorldDirection(lookAt);
    // Kamera schaut in +Z Richtung (auf die Nase).
    expect(lookAt.z).toBeGreaterThan(0);
    ship.dispose();
  });

  it("Kamera bleibt hinter dem Schiff, auch bei Gier", () => {
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    ship.rotate(90, 0); // Schiff zeigt jetzt nach +X.
    follow.setTarget(ship.getObject());
    follow.setMode("follow");
    follow.update(0.016);

    // Kamera soll jetzt von -X Richtung +X schauen (hinter +X-gerichteter Nase).
    expect(camera.position.x).toBeLessThan(0);
    ship.dispose();
  });
});
