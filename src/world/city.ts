import * as THREE from 'three';
import type { Rng } from '../core/rng';
import { pointInBox2D, type Box, type SpatialHash } from './collision';

export interface RoadSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
}

export interface CityResult {
  root: THREE.Group;
  roads: RoadSegment[];
  spawn: THREE.Vector3;
  cityRadius: number;
}

/** Canvas-generated emissive window texture (lit and unlit windows). */
function makeWindowTexture(seedOffset: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return new THREE.CanvasTexture(c); // headless/test env: blank texture
  let s = 1337 + seedOffset;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  ctx.fillStyle = '#1a1f2e';
  ctx.fillRect(0, 0, 128, 256);
  for (let y = 8; y < 250; y += 14) {
    for (let x = 8; x < 122; x += 12) {
      const lit = rnd() < 0.42;
      const warm = rnd() < 0.7;
      ctx.fillStyle = lit ? (warm ? '#ffd98a' : '#9fd8ff') : '#242a3a';
      ctx.globalAlpha = lit ? 0.55 + rnd() * 0.45 : 1;
      ctx.fillRect(x, y, 7, 8);
    }
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const STREET = 12; // street width
const BLOCK = 60; // lot size
const GRID = 9; // 9x9 blocks

/**
 * Builds the city: grid of blocks with 1-4 buildings each, streets on every
 * gridline, sidewalks. Buildings/streets registered in the collision hash
 * with ids `bld:*` and `road:*` (see sampleGround contract).
 */
export function buildCity(rng: Rng, hash: SpatialHash): CityResult {
  const root = new THREE.Group();
  root.name = 'city';
  const roads: RoadSegment[] = [];
  const span = GRID * (BLOCK + STREET) + STREET; // total city size
  const half = span / 2;

  // ---- Streets (dark planes) + collision boxes -------------------------
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.9, metalness: 0 });
  const roadGeo = new THREE.PlaneGeometry(1, 1);
  roadGeo.rotateX(-Math.PI / 2);
  let roadIdx = 0;
  const addRoad = (x: number, z: number, sx: number, sz: number): void => {
    const m = new THREE.Mesh(roadGeo, roadMat);
    m.position.set(x, 0.02, z);
    m.scale.set(sx, 1, sz);
    m.receiveShadow = true;
    root.add(m);
    hash.insert({ center: new THREE.Vector3(x, 0.02, z), half: new THREE.Vector3(sx / 2, 0, sz / 2), yaw: 0 }, `road:${roadIdx++}`);
    roads.push({ x1: x - sx / 2, z1: z - sz / 2, x2: x + sx / 2, z2: z + sz / 2, width: Math.min(sx, sz) });
  };
  // Vertical streets (along Z) and horizontal (along X) at every gridline.
  for (let i = 0; i <= GRID; i++) {
    const p = -half + STREET / 2 + i * (BLOCK + STREET);
    addRoad(p, 0, STREET, span); // vertical
    addRoad(0, p, span, STREET); // horizontal
  }

  // ---- Lane markings (light dashes) ------------------------------------
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8dbe0 });
  const dashGeo = new THREE.PlaneGeometry(0.3, 3);
  dashGeo.rotateX(-Math.PI / 2);
  const dashCount = (GRID + 1) * 2 * 40;
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  let di = 0;
  const dashM = new THREE.Matrix4();
  for (let i = 0; i <= GRID; i++) {
    const p = -half + STREET / 2 + i * (BLOCK + STREET);
    for (let d = -half + 6; d < half - 6; d += 8) {
      if (di < dashCount) {
        dashM.makeTranslation(p, 0.03, d);
        dashes.setMatrixAt(di++, dashM);
        dashM.makeTranslation(d, 0.03, p);
        dashes.setMatrixAt(di++, dashM);
      }
    }
  }
  dashes.count = di;
  root.add(dashes);

  // ---- Sidewalk curbs ---------------------------------------------------
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x8f939c, roughness: 0.85 });
  const curbGeo = new THREE.BoxGeometry(BLOCK + 4, 0.22, BLOCK + 4);
  const curbs: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  // ---- Buildings (3 material tiers, instanced) --------------------------
  const tiers = [
    { mat: new THREE.MeshStandardMaterial({ color: 0x5d6b7e, roughness: 0.4, metalness: 0.55 }), boxes: [] as THREE.Matrix4[] },
    { mat: new THREE.MeshStandardMaterial({ color: 0x8a7f72, roughness: 0.75, metalness: 0.1 }), boxes: [] as THREE.Matrix4[] },
    { mat: new THREE.MeshStandardMaterial({ color: 0xa35050, roughness: 0.85, metalness: 0.05 }), boxes: [] as THREE.Matrix4[] },
  ];
  // Emissive window overlay: same box scaled 1.001, MeshBasicMaterial with window texture.
  const windowMats = [makeWindowTexture(1), makeWindowTexture(2), makeWindowTexture(3)].map(
    (t) => new THREE.MeshBasicMaterial({ map: t }),
  );
  const windowBoxes: THREE.Matrix4[][] = [[], [], []];

  const m4 = new THREE.Matrix4();
  const scaleV = new THREE.Vector3();
  const posV = new THREE.Vector3();
  let bldIdx = 0;
  const cityRadius = half - STREET;

  for (let bz = 0; bz < GRID; bz++) {
    for (let bx = 0; bx < GRID; bx++) {
      const lotX = -half + STREET + bx * (BLOCK + STREET) + BLOCK / 2;
      const lotZ = -half + STREET + bz * (BLOCK + STREET) + BLOCK / 2;
      const centerDist = Math.hypot(lotX, lotZ);

      // Sidewalk slab under the whole lot.
      curbs.push(m4.clone().compose(posV.set(lotX, 0.11, lotZ), q, one));

      // Parks: some outer lots are green.
      const isPark = rng.next() < 0.12 && centerDist > half * 0.4;
      if (isPark) {
        const parkGeo = new THREE.PlaneGeometry(BLOCK, BLOCK);
        parkGeo.rotateX(-Math.PI / 2);
        const park = new THREE.Mesh(parkGeo, new THREE.MeshStandardMaterial({ color: 0x3f7a38, roughness: 1 }));
        park.position.set(lotX, 0.24, lotZ);
        root.add(park);
        continue;
      }

      // 1-4 buildings per lot. Central lots get taller (downtown).
      const downtown = THREE.MathUtils.clamp(1 - centerDist / (half * 0.9), 0, 1);
      const count = 1 + (rng.next() < 0.7 ? 1 : 0) + (rng.next() < 0.4 ? 1 : 0) + (rng.next() < 0.2 ? 1 : 0);
      const sub = BLOCK / 2; // 2x2 sub-lots max
      for (let i = 0; i < count; i++) {
        const sx = i % 2;
        const sz = Math.floor(i / 2);
        const w = rng.range(sub * 0.55, sub * 0.85);
        const d = rng.range(sub * 0.55, sub * 0.85);
        const stories = Math.round(rng.range(2, 4 + downtown * 26));
        const h = stories * 3.2;
        const x = lotX - sub / 2 + sx * sub + sub / 2;
        const z = lotZ - sub / 2 + sz * sub + sub / 2;
        const tier = downtown > 0.6 ? 0 : rng.int(0, 2);

        scaleV.set(w, h, d);
        posV.set(x, h / 2, z);
        const mat4 = m4.clone().compose(posV, q, scaleV);
        tiers[tier]?.boxes.push(mat4);
        windowBoxes[tier]?.push(m4.clone().compose(posV, q, scaleV.clone().multiplyScalar(1.002)));

        hash.insert(
          { center: new THREE.Vector3(x, h / 2, z), half: new THREE.Vector3(w / 2, h / 2, d / 2), yaw: 0 },
          `bld:${bldIdx++}`,
        );
      }
    }
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  tiers.forEach((tier, i) => {
    if (tier.boxes.length === 0) return;
    const inst = new THREE.InstancedMesh(unitBox, tier.mat, tier.boxes.length);
    tier.boxes.forEach((m, j) => inst.setMatrixAt(j, m));
    inst.castShadow = true;
    inst.receiveShadow = true;
    root.add(inst);
    const winInst = new THREE.InstancedMesh(unitBox, windowMats[i] as THREE.Material, (windowBoxes[i] as THREE.Matrix4[]).length);
    (windowBoxes[i] as THREE.Matrix4[]).forEach((m, j) => winInst.setMatrixAt(j, m));
    root.add(winInst);
  });
  if (curbs.length > 0) {
    const curbInst = new THREE.InstancedMesh(curbGeo, curbMat, curbs.length);
    curbs.forEach((m, j) => curbInst.setMatrixAt(j, m));
    curbInst.receiveShadow = true;
    root.add(curbInst);
  }

  // Spawn: middle intersection, facing +Z (north).
  const spawn = new THREE.Vector3(-half + STREET / 2 + Math.floor(GRID / 2) * (BLOCK + STREET) + BLOCK / 2 + (BLOCK + STREET) / 2, 0, 0);

  return { root, roads, spawn, cityRadius };
}

/** True if a world point is inside any building footprint (for prop placement). */
export function insideBuilding(x: number, z: number, hash: SpatialHash): boolean {
  const near = hash.queryAABB(new THREE.Vector2(x - 1, z - 1), new THREE.Vector2(x + 1, z + 1));
  for (const id of near) {
    if (!id.startsWith('bld:')) continue;
    const b = hash.boxOf(id) as Box | undefined;
    if (b && pointInBox2D(x, z, b)) return true;
  }
  return false;
}
