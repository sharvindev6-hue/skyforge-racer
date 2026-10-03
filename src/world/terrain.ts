import * as THREE from 'three';
import { HeightField } from './collision';

/**
 * Gradient (Perlin-style) value noise built on a seeded permutation table.
 * Returns a function mapping (x, y) -> [0, 1].
 */
function makeNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  let a = seed >>> 0;
  const rnd = () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = perm[i] as number;
    perm[i] = perm[j] as number;
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i] as number;

  const grad = (h: number, x: number, y: number): number => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

  return (x: number, y: number) => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[(perm[X] as number) + Y] as number;
    const ab = perm[(perm[X] as number) + Y + 1] as number;
    const ba = perm[(perm[X + 1] as number) + Y] as number;
    const bb = perm[(perm[X + 1] as number) + Y + 1] as number;
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    // Map from ~[-1, 1] to [0, 1].
    return (x1 * (1 - v) + x2 * v) * 0.75 + 0.5;
  };
}

export interface TerrainResult {
  field: HeightField;
  mesh: THREE.Mesh;
}

/**
 * fBm heightfield: flat at the city center, rolling hills outward.
 * size: world size (square, centered on origin). res: grid resolution.
 * amp: max hill height in meters.
 */
export function buildTerrain(size: number, res: number, seed: number, amp: number): TerrainResult {
  const noise = makeNoise(seed);
  const data = new Float32Array(res * res);
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const x = (ix / (res - 1) - 0.5) * size;
      const z = (iz / (res - 1) - 0.5) * size;
      const r = Math.hypot(x, z);
      // City core (r < 600) totally flat, ramps up to full amp by r=1400.
      const mask = THREE.MathUtils.clamp((r - 600) / 800, 0, 1);
      let h = 0;
      h += noise(x / 900 + 31.7, z / 900 + 11.3) * 1.0;
      h += noise(x / 300 + 100.5, z / 300 + 51.2) * 0.4;
      h += noise(x / 90 + 200.1, z / 90 + 77.7) * 0.12;
      data[iz * res + ix] = (h / 1.52 - 0.5) * 2 * amp * mask;
    }
  }
  const field = new HeightField(size, res, data);

  // Visual mesh: plane geometry displaced to match, vertex-colored by height.
  const geo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x4a7c3f); // grass
  const cMid = new THREE.Color(0x6b8f4e);
  const cHigh = new THREE.Color(0x9aa07b); // dry hilltop
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = field.heightAt(x, z);
    pos.setY(i, h);
    const t = THREE.MathUtils.clamp(h / amp, 0, 1);
    if (t < 0.5) tmp.lerpColors(cLow, cMid, t * 2);
    else tmp.lerpColors(cMid, cHigh, (t - 0.5) * 2);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { field, mesh };
}
