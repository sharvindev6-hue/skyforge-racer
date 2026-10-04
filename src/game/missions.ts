import * as THREE from 'three';
import type { CarPhysics } from '../vehicles/physics';
import type { WorldData } from '../world/worldgen';
import type { Rng } from '../core/rng';

export interface MissionDef {
  id: string;
  kind: 'race' | 'delivery' | 'stunt';
  title: string;
  reward: number;
  /** Target time (race/delivery, seconds) or score (stunt). */
  par: number;
}

export type MissionStatus = 'idle' | 'running' | 'won' | 'lost';

interface Checkpoint {
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
}

/** Glowing gate arch used for race checkpoints and delivery targets. */
function gate(color: number): THREE.Mesh {
  const geo = new THREE.TorusGeometry(4.5, 0.35, 10, 28);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.8,
    transparent: true,
    opacity: 0.92,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = 0;
  return m;
}

export interface MissionEvents {
  onCheckpoint: (n: number, total: number) => void;
  onWon: (mission: MissionDef, timeOrScore: number) => void;
  onLost: (mission: MissionDef, timeOrScore: number) => void;
  onEvent: (kind: 'air' | 'nearmiss' | 'ring' | 'drift', points: number) => void;
}

const RACE_IDS = ['race-downtown', 'race-circuit', 'race-sprint'];
const DELIVERY_IDS = ['delivery-express', 'delivery-heavy'];
const STUNT_IDS = ['stunt-airs', 'stunt-combo'];

/**
 * Mission system. Only one mission active at a time. Races: reach all
 * checkpoints before par. Delivery: pick up then deliver within time.
 * Stunt: score points from airtime/near-miss/rings/drift before time out.
 */
export class Missions {
  active: MissionDef | null = null;
  status: MissionStatus = 'idle';
  /** Seconds elapsed (race/delivery) or score (stunt display). */
  progress = 0;
  checkpointIndex = 0;

  private checkpoints: Checkpoint[] = [];
  private root = new THREE.Group();
  private phase: 'toPickup' | 'toDeliver' = 'toPickup';
  private stuntScore = 0;
  private stuntCombo = 1;
  private comboTimer = 0;
  private airTimer = 0;
  private driftTimer = 0;
  private lastLat = 0;
  private world: WorldData;
  private events: MissionEvents;

  constructor(world: WorldData, private rng: Rng, events: MissionEvents) {
    this.world = world;
    this.events = events;
    this.root.name = 'missions';
    world.root.add(this.root);
  }

  /** Start a mission of the given kind (chosen deterministically from pool). */
  start(kind: MissionDef['kind']): MissionDef | null {
    if (this.active) this.cleanup();
    const pool =
      kind === 'race' ? RACE_IDS : kind === 'delivery' ? DELIVERY_IDS : STUNT_IDS;
    const id = this.rng.pick(pool);
    if (kind === 'race') return this.startRace(id);
    if (kind === 'delivery') return this.startDelivery(id);
    return this.startStunt(id);
  }

  private clearCheckpoints(): void {
    for (const cp of this.checkpoints) this.root.remove(cp.mesh);
    this.checkpoints = [];
  }

  private makeCheckpoints(positions: THREE.Vector3[], color: number): void {
    this.clearCheckpoints();
    positions.forEach((p) => {
      const m = gate(color);
      m.position.copy(p);
      // Face along nearest road direction: arch across the road.
      m.rotation.y = this.nearestRoadYaw(p);
      this.root.add(m);
      this.checkpoints.push({ pos: p, mesh: m });
    });
  }

  private nearestRoadYaw(p: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    for (const r of this.world.roads) {
      const mx = (r.x1 + r.x2) / 2;
      const mz = (r.z1 + r.z2) / 2;
      const d = Math.hypot(mx - p.x, mz - p.z);
      if (d < bestD) {
        bestD = d;
        best = r.x2 - r.x1 > r.z2 - r.z1 ? Math.PI / 2 : 0;
      }
    }
    return best;
  }

  private roadPoint(t: number, ring: number): THREE.Vector3 {
    // Pick a road ~ring intersections out from center, at param t.
    const roads = this.world.roads;
    const r = roads[(Math.floor(this.rng.next() * roads.length) + ring * 7) % roads.length] as NonNullable<
      (typeof roads)[number]
    >;
    const x = r.x1 + (r.x2 - r.x1) * t;
    const z = r.z1 + (r.z2 - r.z1) * t;
    return new THREE.Vector3(x, 2.2, z);
  }

  private startRace(id: string): MissionDef {
    const n = 6 + Math.floor(this.rng.next() * 5);
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) positions.push(this.roadPoint(0.15 + 0.7 * (i / (n - 1)), i));
    this.makeCheckpoints(positions, 0x22d3ee);
    const totalDist = positions.reduce((acc, p, i) => (i === 0 ? 0 : acc + p.distanceTo(positions[i - 1] as THREE.Vector3)), 0);
    const def: MissionDef = { id, kind: 'race', title: 'Street Race', reward: 400 + Math.round(totalDist), par: Math.round(totalDist / 14) + 12 };
    this.active = def;
    this.status = 'running';
    this.progress = 0;
    this.checkpointIndex = 0;
    return def;
  }

  private startDelivery(id: string): MissionDef {
    const pickup = this.roadPoint(this.rng.range(0.2, 0.8), 1);
    const deliver = this.roadPoint(this.rng.range(0.2, 0.8), 4);
    this.makeCheckpoints([pickup, deliver], 0xf59e0b);
    this.phase = 'toPickup';
    const dist = pickup.distanceTo(deliver);
    const def: MissionDef = {
      id,
      kind: 'delivery',
      title: 'Express Delivery',
      reward: 300 + Math.round(dist * 1.2),
      par: Math.round(dist / 12) + 20,
    };
    this.active = def;
    this.status = 'running';
    this.progress = 0;
    this.checkpointIndex = 0;
    return def;
  }

  private startStunt(id: string): MissionDef {
    this.makeCheckpoints([], 0xe879f9);
    const def: MissionDef = { id, kind: 'stunt', title: 'Stunt Challenge', reward: 900, par: 3000 };
    this.active = def;
    this.status = 'running';
    this.progress = 60; // countdown
    this.stuntScore = 0;
    this.stuntCombo = 1;
    return def;
  }

  abandon(): void {
    if (!this.active) return;
    const def = this.active;
    this.status = 'lost';
    this.cleanup();
    this.events.onLost(def, 0);
  }

  /** Removes gates + active mission; keeps terminal status visible to callers. */
  private cleanup(): void {
    this.clearCheckpoints();
    this.active = null;
  }

  /** Called by the game loop each fixed tick. */
  update(car: CarPhysics, dt: number): MissionStatus {
    const def = this.active;
    if (!def || this.status !== 'running') return this.status;
    const s = car.state;

    // Gate pulse.
    const pulse = 1 + Math.sin(this.progress * 4) * 0.06;
    for (const cp of this.checkpoints) cp.mesh.scale.setScalar(pulse);

    if (def.kind === 'stunt') {
      this.progress -= dt;
      this.updateStunt(car, dt);
      if (this.progress <= 0) {
        if (this.stuntScore >= def.par) {
          this.status = 'won';
          this.events.onWon(def, this.stuntScore);
        } else {
          this.status = 'lost';
          this.events.onLost(def, this.stuntScore);
        }
        this.cleanup();
      }
      return this.status;
    }

    this.progress += dt;

    // Time out: failed to finish before par.
    if (this.progress > def.par) {
      this.status = 'lost';
      this.events.onLost(def, this.progress);
      this.cleanup();
      return this.status;
    }

    const target = this.checkpoints[this.checkpointIndex];
    if (!target) return this.status;
    const d = Math.hypot(target.pos.x - s.pos.x, target.pos.z - s.pos.z);
    const yOk = def.kind === 'delivery' && this.phase === 'toPickup' ? true : Math.abs(target.pos.y - s.pos.y) < 8;
    if (d < 6 && yOk) {
      this.events.onCheckpoint(this.checkpointIndex + 1, this.checkpoints.length);
      this.checkpointIndex++;
      // Delivery: swap gate to deliver phase (green).
      if (def.kind === 'delivery' && this.checkpointIndex === 1) {
        this.phase = 'toDeliver';
        (target.mesh.material as THREE.MeshStandardMaterial).color.set(0x22c55e);
        (target.mesh.material as THREE.MeshStandardMaterial).emissive.set(0x22c55e);
        this.checkpointIndex = 1; // deliver gate is index 1
        return this.status;
      }
      if (this.checkpointIndex >= this.checkpoints.length) {
        const within = def.kind === 'race' ? this.progress <= def.par : true;
        this.status = within ? 'won' : 'lost';
        if (within) this.events.onWon(def, this.progress);
        else this.events.onLost(def, this.progress);
        this.cleanup();
      }
    }
    return this.status;
  }

  private updateStunt(car: CarPhysics, dt: number): void {
    const s = car.state;
    // Combo decay.
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.stuntCombo = Math.max(1, this.stuntCombo - dt * 0.5);

    // Airtime points.
    if (s.airborne) {
      this.airTimer += dt;
    } else if (this.airTimer > 0.35) {
      const pts = Math.round(this.airTimer * 200 * this.stuntCombo);
      this.stuntScore += pts;
      this.events.onEvent('air', pts);
      this.stuntCombo = Math.min(5, this.stuntCombo + 0.5);
      this.comboTimer = 3;
      this.airTimer = 0;
    } else {
      this.airTimer = 0;
    }

    // Drift points.
    const lat = this.latSpeed(car);
    const drifting = s.mode === 'drive' && !s.airborne && Math.abs(lat) > 4.5 && car.speed > 8;
    if (drifting) {
      this.driftTimer += dt;
      if (this.driftTimer > 0.5) {
        const pts = Math.round(20 * this.stuntCombo);
        this.stuntScore += pts;
        this.events.onEvent('drift', pts);
        this.comboTimer = 3;
      }
    } else {
      this.driftTimer = 0;
    }
  }

  /** Stunt events called externally (near-miss by Traffic, ring by Collectibles). */
  award(kind: 'nearmiss' | 'ring'): void {
    if (!this.active || this.active.kind !== 'stunt') return;
    const pts = kind === 'nearmiss' ? 150 : 50;
    const scaled = Math.round(pts * this.stuntCombo);
    this.stuntScore += scaled;
    this.events.onEvent(kind, scaled);
    this.stuntCombo = Math.min(5, this.stuntCombo + 0.25);
    this.comboTimer = 3;
  }

  /** World positions of active checkpoints (for HUD minimap blips). */
  gatePositions(): THREE.Vector3[] {
    return this.checkpoints.map((c) => c.pos);
  }

  /** HUD snapshot. */
  hudState(): { title: string; time: number; score: number; checkpoint: number; total: number } {
    const def = this.active;
    return {
      title: def?.title ?? '',
      time: def?.kind === 'stunt' ? this.progress : this.progress,
      score: this.stuntScore,
      checkpoint: this.checkpointIndex,
      total: this.checkpoints.length,
    };
  }

  private latSpeed(car: CarPhysics): number {
    const s = car.state;
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    this.lastLat = s.vel.x * right.x + s.vel.z * right.z;
    return this.lastLat;
  }
}
