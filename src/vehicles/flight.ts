import * as THREE from 'three';
import type { CarPhysics } from './physics';
import type { InputFrame } from '../core/input';
import type { WorldData } from '../world/worldgen';
import { sampleGround } from '../world/collision';

const GRAVITY = -28;
const CEILING = 600;
const STALL_SPEED = 18;
const WHEEL_R = 0.35;

/**
 * Flight model implementing the FlightTick contract from physics.ts.
 * Mode transitions conserve velocity (car -> jet keeps its speed; jet ->
 * hover damps it; hover -> car drops you on your wheels).
 */
export const FlightModel = {
  enterFly(car: CarPhysics): void {
    car.state.mode = 'fly';
    car.state.airborne = true;
    // Nose levels out; forward speed carries over.
    car.state.pitch = THREE.MathUtils.clamp(-car.state.vel.y * 0.03, -0.4, 0.4);
    car.state.roll = 0;
  },

  enterHover(car: CarPhysics): void {
    car.state.mode = 'hover';
    // Hover catches you: kill vertical, damp horizontal hard.
    car.state.vel.y = 0;
    car.state.vel.x *= 0.5;
    car.state.vel.z *= 0.5;
  },

  enterDrive(car: CarPhysics, world: WorldData): void {
    car.state.mode = 'drive';
    car.state.airborne = true; // fall to the ground on next drive tick
    const ground = sampleGround(car.position.x, car.position.z, world.height, world.hash);
    if (car.position.y <= ground.height + WHEEL_R + 0.5) {
      car.state.airborne = false;
      car.position.y = ground.height + WHEEL_R;
    }
    car.state.pitch = 0;
    car.state.roll = 0;
  },

  /** Full 3D jet flight: pitch/roll/yaw, thrust, lift, stall wobble. */
  tickFly(car: CarPhysics, dt: number, input: InputFrame, world: WorldData): void {
    const s = car.state;
    const hover = s.mode === 'hover';

    // Build orientation basis from yaw/pitch/roll.
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch, s.yaw, s.roll, 'YXZ'));
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

    if (hover) {
      // ---- Hover: slow precise flying, altitude hold on release.
      const ground = sampleGround(s.pos.x, s.pos.z, world.height, world.hash);
      // Vertical: W/S climbs/descends, else ease to a stop.
      if (input.throttle > 0.1) s.vel.y += 22 * dt * input.throttle;
      else if (input.brake > 0.1) s.vel.y -= 22 * dt * input.brake;
      else s.vel.y *= Math.exp(-3 * dt);

      // Horizontal thrust + strong damping (aerial parking).
      const yawRate = input.steer * 1.6;
      s.yaw += yawRate * dt;
      const acc = 24;
      s.vel.x += Math.sin(s.yaw) * acc * dt * input.throttle;
      s.vel.z += Math.cos(s.yaw) * acc * dt * input.throttle;
      const damp = Math.exp(-2.2 * dt);
      s.vel.x *= damp;
      s.vel.z *= damp;
      const hSpeed = Math.hypot(s.vel.x, s.vel.z);
      if (hSpeed > 35) {
        s.vel.x *= 35 / hSpeed;
        s.vel.z *= 35 / hSpeed;
      }
      s.pitch *= Math.exp(-4 * dt);
      s.roll = THREE.MathUtils.lerp(s.roll, -input.steer * 0.3, 5 * dt);
      s.vel.y = THREE.MathUtils.clamp(s.vel.y, -12, 12);
      s.pos.y += s.vel.y * dt;

      // Never sink into ground; soft ceiling.
      const groundY = ground.height + 1.2;
      if (s.pos.y < groundY) {
        s.pos.y = groundY;
        s.vel.y = Math.max(0, s.vel.y);
      }
      if (s.pos.y > CEILING) {
        s.pos.y = CEILING;
        s.vel.y = Math.min(0, s.vel.y);
      }
      s.airborne = true;
      s.pos.x += s.vel.x * dt;
      s.pos.z += s.vel.z * dt;
      return;
    }

    // ---- Jet mode ----
    // Thrust along nose; lift counters gravity proportional to speed.
    const thrustAcc = 34 * input.throttle;
    s.vel.addScaledVector(fwd, thrustAcc * dt);

    const speed = s.vel.length();
    const lift = THREE.MathUtils.clamp(speed / 30, 0, 1.25);
    const gravity = GRAVITY * (1 - lift);
    s.vel.y += gravity * dt;

    // Drag: keeps top speed sane (terminal ~105 m/s).
    const drag = 0.32 + (input.handbrake ? 0.9 : 0);
    s.vel.multiplyScalar(Math.exp(-drag * dt));
    if (s.vel.length() > 115) s.vel.setLength(115);

    // Stall: below STALL_SPEED the nose drops and control mushes.
    const stallBlend = THREE.MathUtils.clamp((STALL_SPEED - speed) / STALL_SPEED, 0, 1);
    if (stallBlend > 0) {
      s.vel.y -= stallBlend * 20 * dt;
      s.roll += Math.sin(s.yaw * 7 + s.pos.x) * stallBlend * 0.4 * dt;
      // Nose drops in a stall.
      s.pitch += stallBlend * 0.8 * dt;
    }

    // Rotation: pitch (W = nose up), roll (A/D), yaw follows bank angle.
    const pitchRate = 1.6 * (1 - stallBlend * 0.6);
    s.pitch = THREE.MathUtils.clamp(s.pitch - input.pitch * pitchRate * dt, -1.2, 1.2);
    s.roll = THREE.MathUtils.clamp(s.roll + input.roll * 2.2 * dt, -2.4, 2.4);
    // Auto-level roll slowly when no roll input; yaw from bank angle.
    if (Math.abs(input.roll) < 0.1) s.roll *= Math.exp(-1.2 * dt);
    s.yaw -= Math.sin(s.roll) * 1.1 * dt * (speed > 8 ? 1 : 0);

    // Boost drains shared fuel, big thrust bonus.
    if (input.boost && s.boostFuel > 0) {
      s.boostFuel = Math.max(0, s.boostFuel - 0.35 * dt);
      s.vel.addScaledVector(fwd, 26 * dt);
    } else {
      s.boostFuel = Math.min(1, s.boostFuel + 0.06 * dt);
    }

    // Integrate.
    s.pos.addScaledVector(s.vel, dt);

    // Ceiling.
    if (s.pos.y > CEILING) {
      s.pos.y = CEILING;
      s.vel.y = Math.min(0, s.vel.y);
    }

    // Ground interaction: land if gently descending onto terrain, else bounce off.
    const ground = sampleGround(s.pos.x, s.pos.z, world.height, world.hash);
    const groundY = ground.height + 0.8;
    if (s.pos.y < groundY) {
      if (s.vel.y > -14 && Math.abs(s.pitch) < 0.35 && ground.kind !== 'building') {
        // Touchdown: snap to drive-ish grounded state but stay in fly mode.
        s.pos.y = groundY;
        s.vel.y = 0;
        s.pitch *= 0.2;
        s.roll *= 0.2;
      } else {
        s.pos.y = groundY;
        s.vel.y = Math.abs(s.vel.y) * 0.4; // bounce
        s.pitch = THREE.MathUtils.clamp(s.pitch, -0.2, 0.2);
      }
    }

    // Building tops: land on them (fun rooftop landings).
    if (ground.kind === 'building' && s.pos.y > ground.height - 3 && s.vel.y < -6) {
      s.vel.y = Math.abs(s.vel.y) * 0.3;
    }

    s.airborne = true;
  },
};
