// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarPhysics, CARS } from '../src/vehicles/physics';
import { Missions, type MissionDef } from '../src/game/missions';
import type { WorldData } from '../src/world/worldgen';
import { Rng } from '../src/core/rng';
import { HeightField, SpatialHash } from '../src/world/collision';
import type { RoadSegment } from '../src/world/city';

function worldWithRoads(): WorldData {
  const hash = new SpatialHash(32);
  const roads: RoadSegment[] = [
    { x1: -300, z1: -6, x2: 300, z2: -6, width: 12 }, // horizontal at z=-6
    { x1: -300, z1: 6, x2: 300, z2: 6, width: 12 }, // horizontal at z=6
    { x1: -6, z1: -300, x2: -6, z2: 300, width: 12 }, // vertical at x=-6
    { x1: 6, z1: -300, x2: 6, z2: 300, width: 12 }, // vertical at x=6
  ];
  return {
    seed: 0,
    root: new THREE.Group(),
    hash,
    height: new HeightField(4096, 8, new Float32Array(64)),
    roads,
    ramps: [],
    rings: [],
    spawn: new THREE.Vector3(),
    cityRadius: 280,
    bounds: 3800,
    sky: { update: () => {}, sun: new THREE.DirectionalLight(), daylight: 1 },
  } as WorldData;
}

const car0 = CARS[0] as NonNullable<(typeof CARS)[number]>;

function carAt(x: number, z: number): CarPhysics {
  const car = new CarPhysics(car0);
  car.reset(new THREE.Vector3(x, 0.35, z), 0);
  return car;
}

const eventsObj = {
  won: [] as Array<[MissionDef, number]>,
  lost: [] as Array<[MissionDef, number]>,
  checkpoints: [] as number[],
  onCheckpoint(n: number) {
    this.checkpoints.push(n);
  },
  onWon(m: MissionDef, t: number) {
    this.won.push([m, t]);
  },
  onLost(m: MissionDef, t: number) {
    this.lost.push([m, t]);
  },
  onEvent() {},
};

describe('Missions', () => {
  it('race: driving through all gates under par wins', () => {
    const world = worldWithRoads();
    const missions = new Missions(world, new Rng(5), eventsObj);
    const def = missions.start('race');
    expect(def?.kind).toBe('race');
    expect(missions.checkpointIndex).toBe(0);

    // Teleport through each gate.
    let guard = 0;
    while (missions.status === 'running' && guard++ < 30) {
      const cp = missions.hudState();
      void cp;
      const target = (missions as unknown as { checkpoints: { pos: THREE.Vector3 }[] }).checkpoints[
        missions.checkpointIndex
      ];
      if (!target) break;
      const car = carAt(target.pos.x, target.pos.z);
      car.state.pos.y = target.pos.y;
      missions.update(car, 0.016);
    }
    expect(missions.status).toBe('won');
    expect(eventsObj.won.length).toBe(1);
    expect(eventsObj.checkpoints.length).toBeGreaterThan(3);
  });

  it('delivery requires pickup before delivery', () => {
    const world = worldWithRoads();
    const missions = new Missions(world, new Rng(9), eventsObj);
    const def = missions.start('delivery');
    expect(def?.kind).toBe('delivery');
    const gates = (missions as unknown as { checkpoints: { pos: THREE.Vector3 }[] }).checkpoints;
    expect(gates.length).toBe(2);

    // Go straight to the delivery gate (index 1): should NOT complete.
    const deliver = gates[1] as { pos: THREE.Vector3 };
    const car = carAt(deliver.pos.x, deliver.pos.z);
    car.state.pos.y = deliver.pos.y;
    missions.update(car, 0.016);
    expect(missions.status).toBe('running');

    // Now grab pickup (index 0) then delivery again.
    const pickup = gates[0] as { pos: THREE.Vector3 };
    const car2 = carAt(pickup.pos.x, pickup.pos.z);
    car2.state.pos.y = pickup.pos.y;
    missions.update(car2, 0.016);
    expect(missions.checkpointIndex).toBe(1);
    const car3 = carAt(deliver.pos.x, deliver.pos.z);
    car3.state.pos.y = deliver.pos.y;
    missions.update(car3, 0.016);
    expect(missions.status).toBe('won');
  });

  it('race exceeding par loses', () => {
    const world = worldWithRoads();
    const missions = new Missions(world, new Rng(11), eventsObj);
    const def = missions.start('race');
    expect(def).not.toBeNull();
    // Fast-forward the timer past par by running updates with huge dt.
    const car = carAt(0, 0);
    for (let i = 0; i < 3000 && missions.status === 'running'; i++) missions.update(car, 0.2);
    expect(missions.status).toBe('lost');
  });

  it('stunt awards airtime points and respects target score', () => {
    const world = worldWithRoads();
    const missions = new Missions(world, new Rng(13), eventsObj);
    const def = missions.start('stunt');
    expect(def?.kind).toBe('stunt');

    const car = carAt(0, 0);
    // Simulate: airborne then land, repeatedly.
    let sawEvent = false;
    for (let i = 0; i < 200 && missions.status === 'running'; i++) {
      car.state.airborne = i % 40 < 12;
      missions.update(car, 0.05);
      eventsObj.onEvent = () => {
        sawEvent = true;
      };
    }
    expect(sawEvent).toBe(true);
    expect(missions.hudState().score).toBeGreaterThan(0);
  });

  it('award() only counts during stunt missions', () => {
    const world = worldWithRoads();
    const missions = new Missions(world, new Rng(17), eventsObj);
    missions.award('ring'); // no active mission
    expect(missions.active).toBeNull();
    missions.start('stunt');
    const before = missions.hudState().score;
    missions.award('nearmiss');
    expect(missions.hudState().score).toBeGreaterThan(before);
  });
});
