import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/vehicles/controller';
import { CarPhysics, CARS } from '../src/vehicles/physics';

const car0 = CARS[0] as NonNullable<(typeof CARS)[number]>;

describe('CameraRig', () => {
  it('chase offset sits behind the car heading', () => {
    const rig = new CameraRig();
    // yaw 0 => forward +z => camera behind at -z.
    const a = rig.computeChase({ yaw: 0 }, 8);
    expect(a.x).toBeCloseTo(0, 5);
    expect(a.z).toBeCloseTo(-8, 5);
    // yaw PI/2 => forward +x => camera behind at -x.
    const b = rig.computeChase({ yaw: Math.PI / 2 }, 8);
    expect(b.x).toBeCloseTo(-8, 5);
    expect(b.z).toBeCloseTo(0, 5);
  });

  it('cycles chase -> hood -> orbit -> chase', () => {
    const rig = new CameraRig();
    expect(rig.mode).toBe('chase');
    rig.cycleMode();
    expect(rig.mode).toBe('hood');
    rig.cycleMode();
    expect(rig.mode).toBe('orbit');
    rig.cycleMode();
    expect(rig.mode).toBe('chase');
  });

  it('chase update keeps camera behind a moving car', () => {
    const rig = new CameraRig();
    const camera = new THREE.PerspectiveCamera();
    const car = new CarPhysics(car0);
    car.reset(new THREE.Vector3(50, 0.35, 50), 0);
    rig.snapBehind(car);
    for (let i = 0; i < 60; i++) rig.update(camera, car, 1 / 60, false);
    // Car faces +z, camera should be at smaller z than the car.
    expect(camera.position.z).toBeLessThan(car.position.z);
    expect(camera.position.y).toBeGreaterThan(car.position.y);
  });
});
