import * as THREE from 'three';

/**
 * Collision world: top-down boxes (XZ) with yaw, plus a heightfield for
 * terrain. Vertical resolution is handled by sampling, not full 3D SAT —
 * cars/flyers care about "what's under me" and "did I hit a wall".
 */
export interface Box {
  center: THREE.Vector3;
  half: THREE.Vector3;
  yaw: number;
}

/** Numeric cell key: unique for |cellX| < 2048 (world ±65km at 32m cells). */
function cellKey(cx: number, cz: number): number {
  return cx * 4096 + cz;
}

export class SpatialHash {
  private cells = new Map<number, Set<string>>();
  private boxes = new Map<string, Box>();

  constructor(private cellSize: number) {}

  insert(box: Box, id: string): void {
    this.boxes.set(id, box);
    const cs = this.cellSize;
    const minX = box.center.x - box.half.x;
    const maxX = box.center.x + box.half.x;
    const minZ = box.center.z - box.half.z;
    const maxZ = box.center.z + box.half.z;
    // For yawed boxes pad by the bounding radius of half-extents.
    const pad = Math.hypot(box.half.x, box.half.z) * 0.5;
    for (let cx = Math.floor((minX - pad) / cs); cx <= Math.floor((maxX + pad) / cs); cx++) {
      for (let cz = Math.floor((minZ - pad) / cs); cz <= Math.floor((maxZ + pad) / cs); cz++) {
        const k = cellKey(cx, cz);
        let s = this.cells.get(k);
        if (!s) {
          s = new Set();
          this.cells.set(k, s);
        }
        s.add(id);
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.boxes.clear();
  }

  queryAABB(min: THREE.Vector2, max: THREE.Vector2): string[] {
    const out = new Set<string>();
    const cs = this.cellSize;
    for (let cx = Math.floor(min.x / cs); cx <= Math.floor(max.x / cs); cx++) {
      for (let cz = Math.floor(min.y / cs); cz <= Math.floor(max.y / cs); cz++) {
        const s = this.cells.get(cellKey(cx, cz));
        if (s) s.forEach((id) => out.add(id));
      }
    }
    return [...out];
  }

  boxOf(id: string): Box | undefined {
    return this.boxes.get(id);
  }
}

/** Project a box's extent on a unit axis through origin (2D, XZ plane). */
function axisRange(cx: number, cz: number, hx: number, hz: number, yaw: number, ax: THREE.Vector2): [number, number] {
  const d = cx * ax.x + cz * ax.y;
  // Radius of box onto axis = |half.x * cos(theta)| + |half.z * sin(theta)|
  // where theta is angle between axis and box's local x.
  const ang = Math.atan2(ax.y, ax.x);
  const r = hx * Math.abs(Math.cos(ang - yaw)) + hz * Math.abs(Math.sin(ang - yaw));
  return [d - r, d + r];
}

/** Separating-axis test on the XZ plane for two yawed boxes. */
export function obbOverlap2D(a: Box, b: Box): boolean {
  const axes: THREE.Vector2[] = [
    new THREE.Vector2(Math.cos(a.yaw), Math.sin(a.yaw)),
    new THREE.Vector2(-Math.sin(a.yaw), Math.cos(a.yaw)),
    new THREE.Vector2(Math.cos(b.yaw), Math.sin(b.yaw)),
    new THREE.Vector2(-Math.sin(b.yaw), Math.cos(b.yaw)),
  ];
  for (const ax of axes) {
    const [a0, a1] = axisRange(a.center.x, a.center.z, a.half.x, a.half.z, a.yaw, ax);
    const [b0, b1] = axisRange(b.center.x, b.center.z, b.half.x, b.half.z, b.yaw, ax);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

/** Is world point (x,z) inside box's XZ footprint? */
export function pointInBox2D(x: number, z: number, b: Box): boolean {
  const dx = x - b.center.x;
  const dz = z - b.center.z;
  const c = Math.cos(-b.yaw);
  const s = Math.sin(-b.yaw);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= b.half.x && Math.abs(lz) <= b.half.z;
}

/** Bilinearly interpolated height grid. World origin at grid center. */
export class HeightField {
  constructor(
    private size: number,
    private res: number,
    private data: Float32Array,
  ) {}

  heightAt(x: number, z: number): number {
    const half = this.size / 2;
    const fx = THREE.MathUtils.clamp(((x + half) / this.size) * (this.res - 1), 0, this.res - 1.001);
    const fz = THREE.MathUtils.clamp(((z + half) / this.size) * (this.res - 1), 0, this.res - 1.001);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const h = (ix: number, iz: number) => this.data[iz * this.res + ix] ?? 0;
    const top = h(x0, z0) * (1 - tx) + h(x0 + 1, z0) * tx;
    const bot = h(x0, z0 + 1) * (1 - tx) + h(x0 + 1, z0 + 1) * tx;
    return top * (1 - tz) + bot * tz;
  }

  normalAt(x: number, z: number): THREE.Vector3 {
    const d = this.size / this.res;
    const n = new THREE.Vector3(
      (this.heightAt(x - d, z) - this.heightAt(x + d, z)) / (2 * d),
      1,
      (this.heightAt(x, z - d) - this.heightAt(x, z + d)) / (2 * d),
    );
    return n.normalize();
  }
}

export type SurfaceKind = 'road' | 'terrain' | 'building' | 'ramp';

/** Sample ground height + surface kind at a world position. */
export function sampleGround(x: number, z: number, hf: HeightField, hash: SpatialHash): { height: number; kind: SurfaceKind } {
  let kind: SurfaceKind = 'terrain';
  let height = hf.heightAt(x, z);
  const near = hash.queryAABB(new THREE.Vector2(x - 3, z - 3), new THREE.Vector2(x + 3, z + 3));
  for (const id of near) {
    const b = hash.boxOf(id);
    if (!b || !pointInBox2D(x, z, b)) continue;
    if (id.startsWith('ramp')) {
      if (b.center.y > height) {
        kind = 'ramp';
        height = b.center.y;
      }
    } else if (id.startsWith('bld')) {
      const top = b.center.y + b.half.y;
      if (top > height) {
        kind = 'building';
        height = top;
      }
    } else if (id.startsWith('road')) {
      if (b.center.y > height) {
        kind = 'road';
        height = Math.max(height, b.center.y);
      }
    }
  }
  return { height, kind };
}
