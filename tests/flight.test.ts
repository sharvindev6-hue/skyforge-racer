import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarPhysics, CARS } from '../src/vehicles/physics';
import { FlightModel } from '../src/vehicles/flight';
import type { InputFrame } from '../src/core/input';
import type { WorldData } from '../src/world/worldgen';
import { HeightField, SpatialHash } from '../src/world/collision';

function flatWorld(): WorldData {
  return {
    seed: 0,
    root: new THREE.Group(),
    hash: new SpatialHash(32),
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

const car0 = CARS[0] as NonNullable<(typeof CARS)[number]>;

function movingCar(seconds = 2): CarPhysics {
  const car = new CarPhysics(car0);
  car.reset(new THREE.Vector3(0, 0.35, 0), 0);
  for (let i = 0; i < 60 * seconds; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
  return car;
}

describe('FlightModel', () => {
  it('fly mode gains altitude under pitch and keeps momentum', () => {
    const car = movingCar();
    const v0 = car.state.vel.length();
    FlightModel.enterFly(car);
    expect(car.state.mode).toBe('fly');
    for (let i = 0; i < 60 * 2; i++)
      FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 1, pitch: 1 }, flatWorld());
    expect(car.position.y).toBeGreaterThan(5);
    expect(car.state.vel.length()).toBeGreaterThan(v0 * 0.4);
  });

  it('jet top speed stays bounded by drag', () => {
    const car = movingCar(3);
    FlightModel.enterFly(car);
    for (let i = 0; i < 60 * 10; i++)
      FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 1 }, flatWorld());
    expect(car.state.vel.length()).toBeLessThan(120);
  });

  it('hover mode holds altitude with no input', () => {
    const car = movingCar();
    FlightModel.enterHover(car);
    car.position.y = 30;
    for (let i = 0; i < 60 * 3; i++) FlightModel.tickFly(car, 1 / 60, { ...idle }, flatWorld());
    expect(Math.abs(car.position.y - 30)).toBeLessThan(4);
  });

  it('hover mode caps horizontal speed', () => {
    const car = movingCar();
    FlightModel.enterHover(car);
    for (let i = 0; i < 60 * 6; i++)
      FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 1, steer: 1 }, flatWorld());
    expect(Math.hypot(car.state.vel.x, car.state.vel.z)).toBeLessThan(36);
  });

  it('hover respects the ground', () => {
    const car = movingCar();
    FlightModel.enterHover(car);
    car.position.y = 1;
    for (let i = 0; i < 30; i++)
      FlightModel.tickFly(car, 1 / 60, { ...idle, brake: 1 }, flatWorld());
    expect(car.position.y).toBeGreaterThanOrEqual(1.1);
  });

  it('enterDrive returns to drive mode and drops to ground', () => {
    const world = flatWorld();
    const car = movingCar();
    FlightModel.enterFly(car);
    for (let i = 0; i < 60; i++)
      FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 0.2 }, world);
    FlightModel.enterDrive(car, world);
    expect(car.state.mode).toBe('drive');
    // One drive tick should not throw and should keep car above terrain.
    car.tick(1 / 60, { ...idle, throttle: 0.3 }, world);
    expect(car.position.y).toBeGreaterThan(-1);
  });

  it('momentum is conserved through the car->jet transition', () => {
    const car = movingCar();
    const before = car.state.vel.clone();
    FlightModel.enterFly(car);
    expect(car.state.vel.x).toBeCloseTo(before.x, 5);
    expect(car.state.vel.z).toBeCloseTo(before.z, 5);
  });
});
