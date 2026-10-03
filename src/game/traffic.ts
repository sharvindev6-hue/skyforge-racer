import * as THREE from 'three';
import type { WorldData } from '../world/worldgen';
import type { RoadSegment } from '../world/city';
import type { Rng } from '../core/rng';

interface TrafficCar {
  mesh: THREE.Group;
  road: RoadSegment;
  t: number; // 0..1 along road
  dir: 1 | -1;
  lane: number; // lateral offset from center
  speed: number;
  targetSpeed: number;
  yaw: number;
}

const COUNT = 14;
const COLORS = [0x94a3b8, 0x334155, 0x7c2d12, 0x1d4ed8, 0x166534, 0xca8a04];

/** Simple boxy traffic car. */
function buildTrafficCar(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const color = rng.pick(COLORS) as number;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.6, 3.8),
    new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }),
  );
  body.position.y = 0.65;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.45, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x1a2733, metalness: 0.6, roughness: 0.3 }),
  );
  cabin.position.set(0, 1.12, -0.2);
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.1, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2222, emissiveIntensity: 1.4 }),
  );
  tail.position.set(0, 0.8, -1.92);
  g.add(body, cabin, tail);
  return g;
}

/**
 * Traffic cars drive lane-offset paths along road segments, slow near the
 * player or a car ahead, and wrap around. Player collisions give a bump.
 */
export class Traffic {
  readonly cars: TrafficCar[] = [];
  root = new THREE.Group();
  onBump: (() => void) | null = null;
  private bumpCooldown = 0;

  constructor(world: WorldData, rng: Rng) {
    this.root.name = 'traffic';
    for (let i = 0; i < COUNT; i++) {
      const road = rng.pick(world.roads) as RoadSegment;
      const alongX = road.x2 - road.x1 > road.z2 - road.z1;
      const mesh = buildTrafficCar(rng);
      world.root.add(mesh);
      const car: TrafficCar = {
        mesh,
        road,
        t: rng.next(),
        dir: rng.next() < 0.5 ? 1 : -1,
        lane: (alongX ? 0 : 3.2) * (rng.next() < 0.5 ? 1 : -1),
        speed: 0,
        targetSpeed: rng.range(9, 14),
        yaw: 0,
      };
      this.cars.push(car);
      this.place(car);
    }
  }

  private alongVec(road: RoadSegment): THREE.Vector3 {
    const alongX = road.x2 - road.x1 > road.z2 - road.z1;
    return alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  }

  private place(car: TrafficCar): void {
    const along = this.alongVec(car.road);
    const x1 = car.road.x1 + (along.x > 0 ? 0 : car.lane);
    const z1 = car.road.z1 + (along.z > 0 ? 0 : car.lane);
    const x2 = car.road.x2 + (along.x > 0 ? 0 : car.lane);
    const z2 = car.road.z2 + (along.z > 0 ? 0 : car.lane);
    const x = x1 + (x2 - x1) * car.t;
    const z = z1 + (z2 - z1) * car.t;
    car.mesh.position.set(x, 0.05, z);
    car.yaw = Math.atan2(along.x * car.dir, along.z * car.dir);
    car.mesh.rotation.y = car.yaw;
  }

  update(dt: number, player: { state: { pos: THREE.Vector3; vel: THREE.Vector3 } }): void {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    for (const car of this.cars) {
      // Slow near player (12m cone ahead) or near car ahead on same road.
      let brake = false;
      const along = this.alongVec(car.road);
      const px = car.mesh.position.x + along.x * car.dir * 8;
      const pz = car.mesh.position.z + along.z * car.dir * 8;
      const pd = Math.hypot(player.state.pos.x - px, player.state.pos.z - pz);
      if (pd < 6) brake = true;
      for (const other of this.cars) {
        if (other === car || other.road !== car.road) continue;
        const dAlong = (other.t - car.t) * (along.x !== 0 ? other.road.x2 - other.road.x1 : other.road.z2 - other.road.z1) * car.dir;
        if (dAlong > 0 && dAlong < 10) brake = true;
      }

      car.targetSpeed = brake ? 2 : car.targetSpeed;
      car.speed = THREE.MathUtils.lerp(car.speed, brake ? 2 : 11, brake ? 4 * dt : 1.2 * dt);
      if (brake === false) car.targetSpeed = THREE.MathUtils.clamp(car.targetSpeed, 9, 14);

      const roadLen = along.x !== 0 ? car.road.x2 - car.road.x1 : car.road.z2 - car.road.z1;
      car.t += ((car.speed * car.dir) / Math.abs(roadLen)) * dt;
      if (car.t > 1) car.t -= 1;
      if (car.t < 0) car.t += 1;
      this.place(car);

      // Bump check vs player.
      if (this.bumpCooldown <= 0) {
        const d = car.mesh.position.distanceTo(player.state.pos);
        if (d < 2.6) {
          this.bumpCooldown = 1;
          this.onBump?.();
        }
      }
    }
  }

  dispose(world: WorldData): void {
    for (const car of this.cars) {
      world.root.remove(car.mesh);
      car.mesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    }
    this.cars.length = 0;
  }
}
