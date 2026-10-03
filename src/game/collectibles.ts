import * as THREE from 'three';
import type { CarPhysics } from '../vehicles/physics';
import type { WorldData } from '../world/worldgen';
import type { Rng } from '../core/rng';

export type PickupKind = 'cash' | 'boost';

interface Pickup {
  kind: PickupKind;
  mesh: THREE.Mesh;
  value: number;
  active: boolean;
  respawnAt: number;
  spin: number;
}

export interface CollectibleEvents {
  onCash: (amount: number) => void;
  onBoost: (fraction: number) => void;
  onRing: (amount: number) => void;
}

const CASH_VALUE = [50, 100, 150, 250] as const;
const RESPAWN_S = 60;
const RING_REWARD = 25;

/**
 * Cash pickups + boost tokens on the streets (respawning) and the 60 world
 * rings worth money when flown through. Uses instanced meshes for pickups.
 */
export class Collectibles {
  private pickups: Pickup[] = [];
  private root = new THREE.Group();
  private rings: { obj: THREE.Object3D; cooldown: number }[] = [];
  private time = 0;

  constructor(world: WorldData, rng: Rng, private events: CollectibleEvents) {
    // --- Cash + boost pickups along roads ------------------------------
    const cashGeo = new THREE.BoxGeometry(1.1, 1.1, 0.22);
    const cashMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 0.7,
      metalness: 0.4,
      roughness: 0.3,
    });
    const boostGeo = new THREE.OctahedronGeometry(0.55);
    const boostMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.9,
      metalness: 0.5,
      roughness: 0.25,
    });

    const spots = world.roads.filter((r) => Math.hypot((r.x1 + r.x2) / 2, (r.z1 + r.z2) / 2) < world.cityRadius * 1.4);
    const total = 70;
    for (let i = 0; i < total; i++) {
      const road = rng.pick(spots);
      const t = rng.range(0.1, 0.9);
      const kind: PickupKind = rng.next() < 0.7 ? 'cash' : 'boost';
      const x = road.x1 + (road.x2 - road.x1) * t + rng.range(-road.width / 3, road.width / 3);
      const z = road.z1 + (road.z2 - road.z1) * t + rng.range(-road.width / 3, road.width / 3);
      const mesh = new THREE.Mesh(kind === 'cash' ? cashGeo : boostGeo, kind === 'cash' ? cashMat : boostMat);
      mesh.position.set(x, 1.1, z);
      this.root.add(mesh);
      this.pickups.push({
        kind,
        mesh,
        value: kind === 'cash' ? rng.pick([...CASH_VALUE]) : 0.5,
        active: true,
        respawnAt: 0,
        spin: rng.range(1.5, 3),
      });
    }

    // --- Rings (visual dummies; positions come from world.rings) --------
    world.rings.forEach((obj) => {
      this.rings.push({ obj, cooldown: 0 });
    });

    this.root.name = 'collectibles';
    world.root.add(this.root);
  }

  /** Ring flight-through check happens per-frame in any airborne mode. */
  update(car: CarPhysics, dt: number): void {
    this.time += dt;
    const s = car.state;
    const p = s.pos;

    // Pickups: distance check (cheap, ~70 items).
    for (const pk of this.pickups) {
      pk.mesh.rotation.y += pk.spin * dt;
      if (!pk.active) {
        if (this.time >= pk.respawnAt) {
          pk.active = true;
          pk.mesh.visible = true;
          pk.mesh.scale.setScalar(0.01);
        }
        continue;
      }
      // Pop-in scale.
      const sc = pk.mesh.scale.x;
      if (sc < 1) pk.mesh.scale.setScalar(Math.min(1, sc + dt * 3));
      const d = Math.hypot(pk.mesh.position.x - p.x, pk.mesh.position.z - p.z);
      const dy = Math.abs(pk.mesh.position.y - p.y);
      if (d < 2.2 && dy < 2.5) {
        pk.active = false;
        pk.mesh.visible = false;
        pk.respawnAt = this.time + RESPAWN_S;
        if (pk.kind === 'cash') this.events.onCash(pk.value);
        else this.events.onBoost(pk.value);
      }
    }

    // Rings: only when flying/hovering or airborne.
    if (s.mode === 'drive' && !s.airborne) return;
    for (const ring of this.rings) {
      if (ring.cooldown > 0) {
        ring.cooldown -= dt;
        continue;
      }
      const ro = ring.obj.position;
      const d = Math.sqrt((ro.x - p.x) ** 2 + (ro.z - p.z) ** 2);
      if (d < 5.5 && Math.abs(ro.y - p.y) < 4.5) {
        ring.cooldown = 5;
        this.events.onRing(RING_REWARD);
      }
    }
  }

  dispose(world: WorldData): void {
    world.root.remove(this.root);
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}
