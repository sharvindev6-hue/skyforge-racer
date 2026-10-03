import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  HeightField,
  SpatialHash,
  obbOverlap2D,
  pointInBox2D,
  sampleGround,
  type Box,
} from '../src/world/collision';

const box = (x: number, z: number, hx = 1, hz = 1, yaw = 0): Box => ({
  center: new THREE.Vector3(x, 0, z),
  half: new THREE.Vector3(hx, 1, hz),
  yaw,
});

describe('SpatialHash', () => {
  it('returns ids overlapping the query AABB', () => {
    const h = new SpatialHash(10);
    h.insert(box(5, 5), 'a');
    h.insert(box(50, 50), 'b');
    expect(h.queryAABB(new THREE.Vector2(0, 0), new THREE.Vector2(10, 10))).toEqual(['a']);
  });

  it('boxOf round-trips inserted boxes', () => {
    const h = new SpatialHash(10);
    h.insert(box(3, 4), 'x');
    expect(h.boxOf('x')?.center.x).toBe(3);
    expect(h.boxOf('missing')).toBeUndefined();
  });

  it('query across cell boundaries still finds boxes', () => {
    const h = new SpatialHash(10);
    h.insert(box(15, 15, 6, 6), 'straddle');
    expect(h.queryAABB(new THREE.Vector2(5, 5), new THREE.Vector2(25, 25))).toContain('straddle');
  });

  it('clear empties everything', () => {
    const h = new SpatialHash(10);
    h.insert(box(5, 5), 'a');
    h.clear();
    expect(h.queryAABB(new THREE.Vector2(0, 0), new THREE.Vector2(10, 10))).toEqual([]);
    expect(h.boxOf('a')).toBeUndefined();
  });
});

describe('pointInBox2D', () => {
  it('handles axis-aligned and rotated cases', () => {
    const b = box(10, 10, 2, 5, Math.PI / 4);
    expect(pointInBox2D(10, 10, b)).toBe(true);
    expect(pointInBox2D(0, 0, b)).toBe(false);
    // Local +x of a box with yaw 45deg points to (cos45, sin45) => (10+1.2, 10+1.2) inside.
    expect(pointInBox2D(11.2, 11.2, b)).toBe(true);
    // 6 units along local -z (0.707, -0.707): |lz| = 5.94 > half.z = 5 => outside.
    expect(pointInBox2D(14.2, 5.8, b)).toBe(false);
  });
});

describe('obbOverlap2D', () => {
  it('detects overlap, separation, and yaw rotation cases', () => {
    expect(obbOverlap2D(box(0, 0), box(1, 0))).toBe(true);
    expect(obbOverlap2D(box(0, 0), box(3, 0))).toBe(false);
    const long: Box = { center: new THREE.Vector3(0, 0, 0), half: new THREE.Vector3(3, 1, 0.5), yaw: 0 };
    const rotated: Box = { center: new THREE.Vector3(2.4, 0, 0), half: new THREE.Vector3(0.5, 1, 3), yaw: Math.PI / 2 };
    expect(obbOverlap2D(long, rotated)).toBe(true);
  });

  it('cross-shaped near miss is detected as separated', () => {
    const long: Box = { center: new THREE.Vector3(0, 0, 0), half: new THREE.Vector3(3, 1, 0.5), yaw: 0 };
    // Rotated box spans x in [3.4, 9.4] => 0.4 gap from long box's x in [-3, 3].
    const rotated: Box = { center: new THREE.Vector3(6.4, 0, 0), half: new THREE.Vector3(0.5, 1, 3), yaw: Math.PI / 2 };
    expect(obbOverlap2D(long, rotated)).toBe(false);
  });
});

describe('HeightField', () => {
  it('interpolates flat fields and off-grid samples', () => {
    const data = new Float32Array(16);
    const hf = new HeightField(16, 4, data);
    expect(hf.heightAt(2, 2)).toBe(0);
    expect(hf.heightAt(100, 100)).toBe(0); // clamped edge
  });

  it('interpolates a slope linearly', () => {
    // 4x4 grid over size 4: height = grid z. World x,z in [-2, 2] maps to grid [0, 3].
    const data = new Float32Array(16);
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) data[z * 4 + x] = z;
    const hf = new HeightField(4, 4, data);
    expect(hf.heightAt(-2, -2)).toBeCloseTo(0, 5); // grid corner (0,0)
    expect(hf.heightAt(-2, 2)).toBeCloseTo(3, 2); // grid corner (0,3), edge-clamped
    expect(hf.heightAt(-2, 0)).toBeCloseTo(1.5, 5); // grid center z
    expect(hf.heightAt(-2, -1)).toBeCloseTo(0.75, 5); // quarter point
  });

  it('normal points up on flat terrain', () => {
    const data = new Float32Array(16);
    const hf = new HeightField(16, 4, data);
    const n = hf.normalAt(2, 2);
    expect(n.y).toBeCloseTo(1, 5);
    expect(n.x).toBeCloseTo(0, 5);
    expect(n.z).toBeCloseTo(0, 5);
  });
});

describe('sampleGround', () => {
  it('prefers the highest surface under the point', () => {
    const hash = new SpatialHash(16);
    const hf = new HeightField(64, 8, new Float32Array(64));
    // Road slightly above terrain, ramp higher still.
    hash.insert({ center: new THREE.Vector3(0, 0.1, 0), half: new THREE.Vector3(8, 0.1, 8), yaw: 0 }, 'road:0');
    hash.insert({ center: new THREE.Vector3(0, 2, 0), half: new THREE.Vector3(3, 0.5, 3), yaw: 0 }, 'ramp:0');
    hash.insert({ center: new THREE.Vector3(20, 5, 20), half: new THREE.Vector3(4, 8, 4), yaw: 0 }, 'bld:0');
    const onRamp = sampleGround(0, 0, hf, hash);
    expect(onRamp.kind).toBe('ramp');
    expect(onRamp.height).toBe(2);
    const onRoad = sampleGround(6, 6, hf, hash);
    expect(onRoad.kind).toBe('road');
    const onBld = sampleGround(20, 20, hf, hash);
    expect(onBld.kind).toBe('building');
    const wild = sampleGround(-25, -25, hf, hash);
    expect(wild.kind).toBe('terrain');
    expect(wild.height).toBe(0);
  });
});
