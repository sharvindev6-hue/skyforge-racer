import * as THREE from 'three';
import type { InputFrame } from '../core/input';
import type { WorldData } from '../world/worldgen';
import { obbOverlap2D, sampleGround, type Box } from '../world/collision';

export interface CarSpec {
  id: string;
  name: string;
  price: number;
  /** m/s^2 engine force */
  accel: number;
  /** m/s */
  topSpeed: number;
  /** lateral velocity damping exponent (higher = grippier) */
  grip: number;
  gripDrift: number;
  /** yaw rate at speed, rad/s */
  handling: number;
  style: 'sport' | 'muscle' | 'super';
  colors: number[];
  colorName: string;
}

export const CARS: CarSpec[] = [
  {
    id: 'vortex-gt',
    name: 'Vortex GT',
    price: 0,
    accel: 14,
    topSpeed: 52,
    grip: 6.5,
    gripDrift: 1.2,
    handling: 2.1,
    style: 'sport',
    colors: [0x22d3ee, 0xf8fafc, 0xf43f5e],
    colorName: 'Cyan Flash',
  },
  {
    id: 'bruiser-440',
    name: 'Bruiser 440',
    price: 12000,
    accel: 17,
    topSpeed: 58,
    grip: 4.6,
    gripDrift: 0.9,
    handling: 1.85,
    style: 'muscle',
    colors: [0x1e1b4b, 0x111113, 0xb91c1c],
    colorName: 'Midnight Beast',
  },
  {
    id: 'nova-x1',
    name: 'Nova X1',
    price: 45000,
    accel: 22,
    topSpeed: 68,
    grip: 8,
    gripDrift: 1.6,
    handling: 2.5,
    style: 'super',
    colors: [0xe879f9, 0x0a0a0a, 0xfacc15],
    colorName: 'Fuchsia Ghost',
  },
];

export interface CarState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  yawVel: number;
  pitch: number;
  roll: number;
  airborne: boolean;
  boostFuel: number; // 0..1
  mode: 'drive' | 'fly' | 'hover';
}

const WHEEL_R = 0.35;
const GRAVITY = -28;

/**
 * Arcade car physics: forward/lateral velocity decomposition, grip-based
 * drift, ramp launches, OBB collision against buildings/props, soft bounds.
 * Deterministic given the same inputs + world.
 */
export class CarPhysics {
  readonly state: CarState;
  private spec: CarSpec;
  private boostBonus = 1;

  constructor(spec: CarSpec) {
    this.spec = spec;
    this.state = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      yawVel: 0,
      pitch: 0,
      roll: 0,
      airborne: false,
      boostFuel: 1,
      mode: 'drive',
    };
  }

  get position(): THREE.Vector3 {
    return this.state.pos;
  }

  get yaw(): number {
    return this.state.yaw;
  }

  get speed(): number {
    return Math.hypot(this.state.vel.x, this.state.vel.z);
  }

  forwardSpeed(): number {
    const f = this.forward();
    return this.state.vel.x * f.x + this.state.vel.z * f.z;
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.state.yaw), 0, Math.cos(this.state.yaw));
  }

  reset(pos: THREE.Vector3, yaw = 0): void {
    this.state.pos.copy(pos);
    this.state.vel.set(0, 0, 0);
    this.state.yaw = yaw;
    this.state.yawVel = 0;
    this.state.pitch = 0;
    this.state.roll = 0;
    this.state.airborne = false;
    this.state.boostFuel = 1;
    this.state.mode = 'drive';
  }

  tick(dt: number, input: InputFrame, world: WorldData, flightTick?: FlightTick): void {
    if (this.state.mode !== 'drive' && flightTick) {
      flightTick(this, dt, input, world);
      return;
    }
    const s = this.state;

    // ---- Engine ----
    const boosting = input.boost && s.boostFuel > 0 && input.throttle > 0;
    if (boosting) s.boostFuel = Math.max(0, s.boostFuel - 0.35 * dt);
    else s.boostFuel = Math.min(1, s.boostFuel + 0.1 * dt);
    const boostMul = boosting ? 1.6 * this.boostBonus : 1;

    // Decompose velocity in the current heading frame.
    const f = this.forward();
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    let fwdSpeed = s.vel.x * f.x + s.vel.z * f.z;
    let latSpeed = s.vel.x * right.x + s.vel.z * right.z;

    // Engine + brake on the forward component.
    const topSpeed = this.spec.topSpeed * this.boostBonus;
    let engine = input.throttle * this.spec.accel * boostMul;
    if (fwdSpeed > topSpeed) engine = Math.min(engine, 0);
    engine += input.brake * -26; // brake/reverse force
    fwdSpeed += engine * dt;
    if (fwdSpeed < -12) fwdSpeed = -12; // reverse cap

    // Grip: exponential lateral damping (weak while handbraking = drift).
    const grip = input.handbrake ? this.spec.gripDrift : this.spec.grip;
    latSpeed *= Math.exp(-grip * dt);

    // Steering: scaled by speed, stronger while drifting.
    const steerFactor = THREE.MathUtils.clamp(Math.abs(fwdSpeed) / 12, 0, 1);
    const dir = fwdSpeed < -0.5 ? -1 : 1;
    s.yawVel = input.steer * this.spec.handling * steerFactor * (input.handbrake ? 1.5 : 1) * dir;
    const dYaw = s.yawVel * dt;
    s.yaw += dYaw;

    // Recompose in the NEW frame: rotating the heading transfers part of the
    // forward momentum into lateral (this is what makes the car slide out).
    const cosD = Math.cos(dYaw);
    const sinD = Math.sin(dYaw);
    const newFwd = fwdSpeed * cosD + latSpeed * sinD;
    const newLat = latSpeed * cosD - fwdSpeed * sinD;
    const nf = this.forward();
    const nRight = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    s.vel.x = nf.x * newFwd + nRight.x * newLat;
    s.vel.z = nf.z * newFwd + nRight.z * newLat;

    // Drag + rolling resistance.
    const drag = 0.35;
    s.vel.x -= s.vel.x * drag * dt;
    s.vel.z -= s.vel.z * drag * dt;

    // ---- Vertical ----
    const ground = sampleGround(s.pos.x, s.pos.z, world.height, world.hash);
    const groundY = ground.height + WHEEL_R;
    if (s.airborne) {
      s.vel.y += GRAVITY * dt;
      s.pos.y += s.vel.y * dt;
      // Visual pitch from vertical motion.
      s.pitch = THREE.MathUtils.clamp(-s.vel.y * 0.04, -0.5, 0.5);
      s.roll *= Math.exp(-2 * dt);
      if (s.pos.y <= groundY && s.vel.y <= 0) {
        s.pos.y = groundY;
        s.vel.y = 0;
        s.airborne = false;
        s.pitch = 0;
      }
    } else {
      // Ground follow + ramp launch detection: if ground drops away sharply
      // while moving fast, become airborne.
      const ahead = sampleGround(s.pos.x + nf.x * 1.5, s.pos.z + nf.z * 1.5, world.height, world.hash);
      const speed = Math.abs(newFwd);
      if (ahead.height < groundY - 0.8 && speed > 14) {
        // Driving off an edge (e.g. ramp tip) => ballistic.
        s.airborne = true;
        s.vel.y = Math.min(s.vel.y, 0) + speed * 0.12;
      } else {
        s.pos.y += (groundY - s.pos.y) * Math.min(1, 12 * dt);
        // Ramps push you up: if on a ramp surface rising ahead, gain vertical.
        if (ground.kind === 'ramp' && ahead.height > ground.height + 0.3 && speed > 6) {
          s.vel.y = speed * 0.28;
          s.airborne = true;
        }
      }
    }

    // ---- Integrate horizontal ----
    s.pos.x += s.vel.x * dt;
    s.pos.z += s.vel.z * dt;

    // ---- Collisions: buildings/props ----
    const carBox: Box = {
      center: s.pos,
      half: new THREE.Vector3(1.05, 0.7, 2.3),
      yaw: s.yaw,
    };
    const near = world.hash.queryAABB(
      new THREE.Vector2(s.pos.x - 4, s.pos.z - 4),
      new THREE.Vector2(s.pos.x + 4, s.pos.z + 4),
    );
    for (const id of near) {
      if (id.startsWith('road') || id.startsWith('ramp')) continue;
      const b = world.hash.boxOf(id);
      if (!b || !obbOverlap2D(carBox, b)) continue;
      // Push out along smallest penetration axis (XZ), reflect velocity.
      const dx = s.pos.x - b.center.x;
      const dz = s.pos.z - b.center.z;
      const c = Math.cos(-b.yaw);
      const sn = Math.sin(-b.yaw);
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      const penX = b.half.x + carBox.half.x * Math.abs(Math.cos(s.yaw - b.yaw)) - Math.abs(lx);
      const penZ = b.half.z + carBox.half.z * Math.abs(Math.cos(s.yaw - b.yaw)) - Math.abs(lz);
      const impact = Math.abs(fwdSpeed);
      if (Math.abs(lx) / (b.half.x + 0.001) > Math.abs(lz) / (b.half.z + 0.001)) {
        const push = lx > 0 ? penX : -penX;
        s.pos.x += push * c;
        s.pos.z -= push * sn;
        s.vel.x *= -0.3;
      } else {
        const push = lz > 0 ? penZ : -penZ;
        s.pos.x += push * sn;
        s.pos.z += push * c;
        s.vel.z *= -0.3;
      }
      // Kill some forward speed on impact.
      s.vel.multiplyScalar(0.72);
      void impact;
    }

    // ---- Soft world bounds ----
    const r = Math.hypot(s.pos.x, s.pos.z);
    if (r > world.bounds) {
      const inward = new THREE.Vector3(-s.pos.x, 0, -s.pos.z).normalize();
      const over = r - world.bounds;
      s.pos.x += inward.x * over;
      s.pos.z += inward.z * over;
      const vDot = s.vel.x * inward.x + s.vel.z * inward.z;
      if (vDot < 0) {
        s.vel.x -= inward.x * vDot * 1.5;
        s.vel.z -= inward.z * vDot * 1.5;
      }
    }
  }
}

/** Flight behavior injected by vehicles/flight.ts (avoids import cycle). */
export interface FlightTick {
  (car: CarPhysics, dt: number, input: InputFrame, world: WorldData): void;
}
