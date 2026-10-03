import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarPhysics, CARS } from '../src/vehicles/physics';
import type { InputFrame } from '../src/core/input';
import type { WorldData } from '../src/world/worldgen';
import { HeightField, SpatialHash } from '../src/world/collision';

/** Flat empty world for physics tests. */
function flatWorld(): WorldData {
  const hash = new SpatialHash(32);
  return {
    seed: 0,
    root: new THREE.Group(),
    hash,
    height: new HeightField(4096, 8, new Float32Array(64)),
    roads: [],
    ramps: [],
    rings: [],
    spawn: new THREE.Vector3(),
    cityRadius: 100,
    bounds: 3800,
    sky: { update: () => {}, sun: new THREE.DirectionalLight(), daylight: 1 },
  } as WorldData;
}

const idle: InputFrame = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  boost: false,
  toggleModePressed: false,
  pitch: 0,
  roll: 0,
  yaw: 0,
  cameraPressed: false,
  pausePressed: false,
  resetPressed: false,
};

describe('CarPhysics', () => {
  it('accelerates forward and respects top speed', () => {
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(0, 0.35, 0), 0);
    const input = { ...idle, throttle: 1 };
    for (let i = 0; i < 60 * 40; i++) car.tick(1 / 60, input, flatWorld());
    expect(car.speed).toBeGreaterThan(30);
    expect(car.speed).toBeLessThanOrEqual((CARS[0] as NonNullable<(typeof CARS)[number]>).topSpeed + 0.6);
  });

  it('steering changes yaw when moving, not when stopped', () => {
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(0, 0.35, 0), 0);
    car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    const movingY0 = car.yaw;
    car.tick(1 / 60, { ...idle, throttle: 1, steer: 1 }, flatWorld());
    expect(Math.abs(car.yaw - movingY0)).toBeGreaterThan(0.001);

    const parked = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    parked.reset(new THREE.Vector3(0, 0.35, 0), 0);
    const y0 = parked.yaw;
    for (let i = 0; i < 30; i++) parked.tick(1 / 60, { ...idle, steer: 1 }, flatWorld());
    expect(parked.yaw).toBe(y0);
  });

  it('handbrake drift increases lateral velocity vs clean turn', () => {
    const run = (handbrake: boolean): number => {
      const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
      car.reset(new THREE.Vector3(0, 0.35, 0), 0);
      for (let i = 0; i < 90; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
      for (let i = 0; i < 30; i++)
        car.tick(1 / 60, { ...idle, throttle: 1, steer: 1, handbrake }, flatWorld());
      const f = car.forward();
      const fwd = car.state.vel.x * f.x + car.state.vel.z * f.z;
      return Math.hypot(car.state.vel.x, car.state.vel.z) - Math.abs(fwd);
    };
    const driftLat = run(true);
    const gripLat = run(false);
    expect(driftLat).toBeGreaterThan(gripLat + 1);
  });

  it('boost drains fuel and adds speed', () => {
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(0, 0.35, 0), 0);
    const withBoost = { ...idle, throttle: 1, boost: true };
    for (let i = 0; i < 240; i++) car.tick(1 / 60, withBoost, flatWorld());
    expect(car.state.boostFuel).toBeLessThan(0.9);
  });

  it('collides with a building and loses speed', () => {
    const world = flatWorld();
    world.hash.insert(
      { center: new THREE.Vector3(0, 10, 60), half: new THREE.Vector3(10, 10, 10), yaw: 0 },
      'bld:test',
    );
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(0, 0.35, 0), 0);
    const input = { ...idle, throttle: 1 };
    for (let i = 0; i < 60 * 12; i++) car.tick(1 / 60, input, world);
    // Must not have tunneled into the building.
    expect(car.position.z).toBeLessThan(68);
  });

  it('soft bounds push the car back inside', () => {
    const world = flatWorld();
    world.bounds = 100;
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(90, 0.35, 0), Math.PI / 2); // facing +x
    for (let i = 0; i < 60 * 20; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, world);
    expect(Math.hypot(car.position.x, car.position.z)).toBeLessThan(130);
  });

  it('resets cleanly', () => {
    const car = new CarPhysics(CARS[0] as NonNullable<(typeof CARS)[number]>);
    car.reset(new THREE.Vector3(5, 0.35, 5), 1);
    car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    car.reset(new THREE.Vector3(0, 0.35, 0), 0);
    expect(car.position.equals(new THREE.Vector3(0, 0.35, 0))).toBe(true);
    expect(car.speed).toBe(0);
    expect(car.state.mode).toBe('drive');
  });
});
