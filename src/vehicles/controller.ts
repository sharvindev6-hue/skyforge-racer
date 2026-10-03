import * as THREE from 'three';
import { CarPhysics, type CarSpec } from './physics';
import { FlightModel } from './flight';
import { buildCarMesh, type CarMeshResult } from './carMesh';
import type { Input } from '../core/input';
import type { WorldData } from '../world/worldgen';
import { sampleGround } from '../world/collision';

const TRANSFORM_TIME = 0.8;

/**
 * Third-person camera rig: chase (lerped), hood (rigid), orbit (showcase).
 */
export class CameraRig {
  mode: 'chase' | 'hood' | 'orbit' = 'chase';
  private pos = new THREE.Vector3(0, 5, -10);
  private orbitAngle = 0;

  /** Offset behind a yaw-facing object (pure, testable). */
  computeChase(car: { yaw: number }, dist: number): { x: number; z: number } {
    return { x: -Math.sin(car.yaw) * dist, z: -Math.cos(car.yaw) * dist };
  }

  cycleMode(): void {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'orbit' : 'chase';
  }

  update(camera: THREE.PerspectiveCamera, car: CarPhysics, dt: number, airborne: boolean): void {
    const s = car.state;
    const speed01 = THREE.MathUtils.clamp(car.speed / 60, 0, 1);
    const dist = 9 + speed01 * 3.5 + (s.mode !== 'drive' ? 4 : 0);
    const height = s.mode !== 'drive' ? 4.5 + speed01 * 2 : 3.6;

    if (this.mode === 'hood') {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch, s.yaw, s.roll, 'YXZ'));
      const eye = new THREE.Vector3(0, 1.15, 0.4).applyQuaternion(q).add(s.pos);
      camera.position.copy(eye);
      const look = new THREE.Vector3(0, 0.9, 12).applyQuaternion(q).add(s.pos);
      camera.lookAt(look);
      return;
    }

    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.5;
      camera.position.set(
        s.pos.x + Math.cos(this.orbitAngle) * 11,
        s.pos.y + 4.5,
        s.pos.z + Math.sin(this.orbitAngle) * 11,
      );
      camera.lookAt(s.pos);
      return;
    }

    // Chase: lerped follow with velocity lead.
    const offset = this.computeChase({ yaw: s.yaw }, dist);
    const target = new THREE.Vector3(s.pos.x + offset.x, s.pos.y + height, s.pos.z + offset.z);
    // While airborne/jet, camera sits behind the 3D orientation instead.
    if (s.mode === 'fly' || (airborne && s.mode !== 'hover')) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch * 0.5, s.yaw, s.roll * 0.4, 'YXZ'));
      const back = new THREE.Vector3(0, height * 0.4, -dist).applyQuaternion(q);
      target.set(s.pos.x + back.x, Math.max(s.pos.y + back.y, s.pos.y - 2), s.pos.z + back.z);
    }
    const k = 1 - Math.exp(-(s.mode === 'drive' ? 8 : 5) * dt);
    this.pos.lerp(target, k);
    camera.position.copy(this.pos);
    const lead = new THREE.Vector3(s.pos.x, s.pos.y + 1.2, s.pos.z);
    if (s.mode === 'fly') {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch, s.yaw, s.roll, 'YXZ'));
      lead.add(new THREE.Vector3(0, 0, 14).applyQuaternion(q).multiplyScalar(0.4));
    }
    camera.lookAt(lead);
  }

  snapBehind(car: CarPhysics): void {
    const offset = this.computeChase({ yaw: car.yaw }, 11);
    this.pos.set(car.position.x + offset.x, car.position.y + 4, car.position.z + offset.z);
  }
}

/** Drift/boost particle pool (additive points, recycled). */
class SmokePool {
  points: THREE.Points;
  private life: Float32Array;
  private vel: Float32Array;
  private count: number;
  private cursor = 0;

  constructor(count = 300) {
    this.count = count;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) pos[i * 3 + 1] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdddddd,
      size: 1.6,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.life = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
  }

  emit(x: number, y: number, z: number, vx: number, vz: number, spread = 1): void {
    const i = this.cursor++ % this.count;
    const posAttr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.setXYZ(i, x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread);
    this.vel[i * 3] = vx * 0.2 + (Math.random() - 0.5) * 1.5;
    this.vel[i * 3 + 1] = 1.2 + Math.random() * 1.6;
    this.vel[i * 3 + 2] = vz * 0.2 + (Math.random() - 0.5) * 1.5;
    this.life[i] = 0.9;
    posAttr.needsUpdate = true;
  }

  update(dt: number): void {
    const posAttr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const life = this.life[i] ?? 0;
      if (life <= 0) continue;
      const next = life - dt;
      this.life[i] = next;
      if (next <= 0) {
        posAttr.setY(i, -999);
        dirty = true;
        continue;
      }
      const vx = this.vel[i * 3] ?? 0;
      const vy = this.vel[i * 3 + 1] ?? 0;
      const vz = this.vel[i * 3 + 2] ?? 0;
      posAttr.setXYZ(
        i,
        posAttr.getX(i) + vx * dt,
        posAttr.getY(i) + vy * dt,
        posAttr.getZ(i) + vz * dt,
      );
      dirty = true;
    }
    if (dirty) posAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/**
 * Glues input -> physics/flight -> visuals, runs the transform cinematic,
 * animates wheels/smoke, and owns the camera rig.
 */
export class VehicleController {
  car: CarPhysics;
  mesh: THREE.Group;
  rig = new CameraRig();
  onModeChange: ((mode: 'drive' | 'fly' | 'hover') => void) | null = null;

  private parts: CarMeshResult;
  private input: Input;
  private world: WorldData;
  private smoke = new SmokePool(300);
  private transformT = 0; // 0 = car, 1 = fully transformed
  private transformTarget = 0;
  private steerVis = 0;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(
    scene: THREE.Scene,
    input: Input,
    world: WorldData,
    spec: CarSpec,
    camera: THREE.PerspectiveCamera,
    colorIndex = 0,
  ) {
    this.scene = scene;
    this.input = input;
    this.world = world;
    this.camera = camera;
    this.car = new CarPhysics(spec);
    this.parts = buildCarMesh(spec, colorIndex, true);
    this.mesh = this.parts.group;
    scene.add(this.mesh, this.smoke.points);
    this.car.reset(world.spawn, 0);
    // Place on ground at spawn.
    const g = sampleGround(world.spawn.x, world.spawn.z, world.height, world.hash);
    this.car.state.pos.y = g.height + 0.35;
    this.rig.snapBehind(this.car);
  }

  setCameraMode(m: 'chase' | 'hood' | 'orbit'): void {
    this.rig.mode = m;
  }

  /** Swap the car mesh after a garage purchase. Disposes nothing shared. */
  private lastLat = 0;

  update(dt: number, paused: boolean): void {
    const frame = this.input.frame;
    const car = this.car;

    if (!paused) {
      // Mode toggle: drive -> fly -> hover -> drive.
      if (frame.toggleModePressed) {
        if (car.state.mode === 'drive') {
          FlightModel.enterFly(car);
          this.transformTarget = 1;
          this.onModeChange?.('fly');
        } else if (car.state.mode === 'fly') {
          FlightModel.enterHover(car);
          this.onModeChange?.('hover');
        } else {
          FlightModel.enterDrive(car, this.world);
          this.transformTarget = 0;
          this.onModeChange?.('drive');
        }
      }

      if (frame.cameraPressed) this.rig.cycleMode();
      if (frame.resetPressed) this.respawn();

      car.tick(dt, frame, this.world, FlightModel.tickFly);

      // Drift smoke: rear wheels when sliding fast on ground.
      const lat = this.lateralSpeed();
      const sliding = car.state.mode === 'drive' && !car.state.airborne && Math.abs(lat) > 4.2;
      if (sliding && Math.random() < 0.75) {
        const back = car.forward().multiplyScalar(-1.9);
        this.smoke.emit(
          car.position.x + back.x,
          car.position.y + 0.15,
          car.position.z + back.z,
          car.state.vel.x,
          car.state.vel.z,
          1.6,
        );
      }
    }

    // Transform cinematic (wings + thruster glow).
    const tDir = Math.sign(this.transformTarget - this.transformT);
    if (tDir !== 0) {
      this.transformT = THREE.MathUtils.clamp(this.transformT + tDir * (dt / TRANSFORM_TIME), 0, 1);
      const eased = this.transformT * this.transformT * (3 - 2 * this.transformT);
      this.parts.wings.visible = eased > 0.02;
      this.parts.wings.scale.setScalar(Math.max(eased, 0.001));
      this.parts.wings.rotation.x = (1 - eased) * 0.9;
      for (const h of this.parts.headlights)
        (h.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.2 + eased * 1.5;
    }

    // Visual sync.
    const s = car.state;
    this.mesh.position.copy(s.pos);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.rotateY(s.yaw);
    this.mesh.rotateX(-s.pitch);
    this.mesh.rotateZ(s.roll);

    // Wheels: spin + steer.
    const fwd = car.forwardSpeed();
    const spin = (fwd / 0.35) * dt;
    this.steerVis = THREE.MathUtils.lerp(this.steerVis, frame.steer * 0.45, 10 * dt);
    this.parts.wheels.forEach((w, i) => {
      w.rotation.x -= spin;
      if (i < 2) w.rotation.y = this.steerVis;
    });

    this.smoke.update(dt);

    // Camera follows.
    this.rig.update(this.camera, car, dt, car.state.airborne);
  }

  respawn(): void {
    const s = this.car.state;
    s.mode = 'drive';
    this.transformTarget = 0;
    this.transformT = 0;
    this.parts.wings.visible = false;
    this.car.reset(this.world.spawn, 0);
    const g = sampleGround(this.world.spawn.x, this.world.spawn.z, this.world.height, this.world.hash);
    this.car.state.pos.y = g.height + 0.35;
    this.rig.snapBehind(this.car);
    this.onModeChange?.('drive');
  }

  private lateralSpeed(): number {
    const s = this.car.state;
    const right = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    return s.vel.x * right.x + s.vel.z * right.z;
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.smoke.points);
    this.smoke.dispose();
    this.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }
}
