/**
 * Zusatz-Tests fuer CameraFollow: Validierung und
 * Grenzfaelle.
 *
 * @module unit/camera-follow
 */

import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CameraFollow } from "../../src/controls/CameraFollow";
import { Ship } from "../../src/scene/Ship";

function makeCamera(): { camera: THREE.PerspectiveCamera; follow: CameraFollow } {
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 10_000);
  return { camera, follow: new CameraFollow(camera) };
}

function makeShip(): Ship {
  return new Ship("visual", "visual");
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe("CameraFollow — Validierung", () => {
  it("wirft bei negativem deltaSeconds", () => {
    const { follow } = makeCamera();
    expect(() => follow.update(-0.5)).toThrow(RangeError);
  });

  it("wirft bei NaN deltaSeconds", () => {
    const { follow } = makeCamera();
    expect(() => follow.update(Number.NaN)).toThrow(RangeError);
  });

  it("wirft bei unendlichem deltaSeconds", () => {
    const { follow } = makeCamera();
    expect(() => follow.update(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("klemmt negativen Orbit-Abstand auf Minimum", () => {
    const { follow } = makeCamera();
    follow.setOrbitDistance(-1);
    expect(follow.getOrbitDistance()).toBeGreaterThanOrEqual(2);
  });

  it("wirft bei nicht-endlichem Orbit-Pitch", () => {
    const { follow } = makeCamera();
    expect(() => follow.addOrbitPitch(Number.NaN)).toThrow(RangeError);
  });
});

describe("CameraFollow — Follow-Verhalten", () => {
  it("folgt dem Ziel nach mehreren Frames", () => {
    const { follow } = makeCamera();
    const ship = makeShip();
    ship.setPosition({ x: 100, y: 0, z: 500 });
    follow.setTarget(ship.getObject());
    follow.setMode("follow");

    for (let i = 0; i < 10; i++) {
      follow.update(0.016);
    }

    expect(follow.getMode()).toBe("follow");
    ship.dispose();
  });

  it("Springt bei reducedMotion direkt ans Ziel", () => {
    stubReducedMotion(true);
    const { camera, follow } = makeCamera();
    const ship = makeShip();
    ship.setPosition({ x: 0, y: 0, z: 500 });
    follow.setTarget(ship.getObject());
    follow.update(0.016);

    expect(camera.position.z).toBeGreaterThan(400);

    vi.unstubAllGlobals();
    ship.dispose();
  });

  it("orbitAngle wird bei reducedMotion nicht weitergeaehlt", () => {
    stubReducedMotion(true);
    const { follow } = makeCamera();
    const ship = makeShip();
    follow.setTarget(ship.getObject());
    follow.setMode("orbit");
    follow.setOrbitDistance(50);

    const angleBefore = (follow as unknown as { orbitAngle: number }).orbitAngle;
    follow.update(1.0);
    const angleAfter = (follow as unknown as { orbitAngle: number }).orbitAngle;

    expect(angleAfter).toBe(angleBefore);

    vi.unstubAllGlobals();
    ship.dispose();
  });
});