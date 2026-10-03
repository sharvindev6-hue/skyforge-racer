import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { SpatialHash } from './collision';
import { insideBuilding, type RoadSegment } from './city';

export interface RampDef {
  x: number;
  z: number;
  yaw: number;
  length: number;
  rise: number;
}

export interface PropsResult {
  root: THREE.Group;
  ramps: RampDef[];
  rings: THREE.Object3D[];
}

/** Wedge ramp mesh: rises along +Z of its local frame. */
function rampGeometry(length: number, width: number, rise: number): THREE.BufferGeometry {
  // Triangular prism, high edge at +Z.
  const half = width / 2;
  const verts = new Float32Array([
    // Sloped top face (two triangles)
    -half, 0, 0, half, 0, 0, half, rise, length,
    -half, 0, 0, half, rise, length, -half, rise, length,
    // Back face (vertical)
    -half, 0, length, half, rise, length, half, 0, length,
    -half, 0, length, half, 0, length, -half, 0, length,
    // Bottom
    -half, 0, 0, -half, 0, length, half, 0, length,
    -half, 0, 0, half, 0, length, half, 0, 0,
    // Left side
    -half, 0, 0, -half, rise, length, -half, 0, length,
    // Right side
    half, 0, 0, half, 0, length, half, rise, length,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Places gameplay props: launch ramps along streets, boost rings (collected
 * in flight), palm trees and billboards for flavor. Registers ramps in the
 * collision hash with ids `ramp:*`.
 */
export function buildProps(rng: Rng, hash: SpatialHash, roads: RoadSegment[]): PropsResult {
  const root = new THREE.Group();
  root.name = 'props';
  const ramps: RampDef[] = [];
  const rings: THREE.Object3D[] = [];

  // ---- Ramps: 24 along street edges ------------------------------------
  const rampMat = new THREE.MeshStandardMaterial({ color: 0xc2740a, roughness: 0.6, metalness: 0.3 });
  const stripesMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  for (let i = 0; i < 24; i++) {
    const road = rng.pick(roads);
    const alongX = road.x2 - road.x1 > road.z2 - road.z1; // horizontal street
    const len = rng.range(14, 22);
    const width = 10;
    const rise = rng.range(2.5, 5.5);
    const yaw = alongX ? (rng.next() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : rng.next() < 0.5 ? 0 : Math.PI;
    // Position: along the road, not overlapping intersections (keep to middle 60%).
    const t = rng.range(0.2, 0.8);
    let x: number;
    let z: number;
    if (alongX) {
      x = road.x1 + (road.x2 - road.x1) * t;
      z = road.z1 + road.width / 2;
    } else {
      x = road.x1 + road.width / 2;
      z = road.z1 + (road.z2 - road.z1) * t;
    }
    if (insideBuilding(x, z, hash)) continue;

    const geo = rampGeometry(len, width, rise);
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.position.set(x, 0.05, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    // Collision: approximate the wedge with a rotated flat box at mid height.
    // sampleGround treats `ramp:` ids as height = center.y when inside footprint.
    const cos = Math.abs(Math.cos(yaw));
    const sin = Math.abs(Math.sin(yaw));
    const hx = (alongX ? len : width) / 2;
    const hz = (alongX ? width : len) / 2;
    hash.insert(
      {
        center: new THREE.Vector3(x + Math.sin(yaw) * len * 0.5 * (alongX ? 0 : 1) + Math.cos(yaw) * len * 0.5 * (alongX ? 1 : 0), rise / 2 + 0.05, z + Math.cos(yaw) * len * 0.5 * (alongX ? 0 : 1) + Math.sin(yaw) * len * 0.5 * (alongX ? 1 : 0)),
        half: new THREE.Vector3(hx * (alongX ? 1 : 1), rise / 2, hz),
        yaw: 0,
      },
      `ramp:${i}`,
    );
    void cos;
    void sin;
    void stripesMat;
    ramps.push({ x, z, yaw, length: len, rise });
  }

  // ---- Boost rings: 60 torus rings floating above streets/hills ---------
  const ringGeo = new THREE.TorusGeometry(6, 0.5, 10, 28);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  const ringInst = new THREE.InstancedMesh(ringGeo, ringMat, 60);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  let placed = 0;
  let guard = 0;
  while (placed < 60 && guard++ < 500) {
    const road = rng.pick(roads);
    const t = rng.range(0.1, 0.9);
    const x = road.x1 + (road.x2 - road.x1) * t + rng.range(-road.width / 3, road.width / 3);
    const z = road.z1 + (road.z2 - road.z1) * t + rng.range(-road.width / 3, road.width / 3);
    const y = rng.range(12, 70);
    if (insideBuilding(x, z, hash)) continue;
    // Ring faces along the street direction.
    const alongX = road.x2 - road.x1 > road.z2 - road.z1;
    q.setFromEuler(new THREE.Euler(0, alongX ? Math.PI / 2 : 0, 0));
    pos.set(x, y, z);
    m4.compose(pos, q, scl);
    ringInst.setMatrixAt(placed, m4);
    const holder = new THREE.Object3D();
    holder.position.copy(pos);
    holder.userData.ringIndex = placed;
    rings.push(holder);
    placed++;
  }
  ringInst.count = placed;
  ringInst.name = 'rings';
  root.add(ringInst);

  // ---- Palms: instanced trunks + fronds, along outer roads --------------
  const palmCount = 80;
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 7, 6);
  trunkGeo.translate(0, 3.5, 0);
  const frondGeo = new THREE.ConeGeometry(2.4, 2.2, 7);
  frondGeo.translate(0, 7.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x3d8a3a, roughness: 0.9 });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCount);
  const fronds = new THREE.InstancedMesh(frondGeo, frondMat, palmCount);
  let palms = 0;
  guard = 0;
  while (palms < palmCount && guard++ < 600) {
    const road = rng.pick(roads);
    const t = rng.range(0.05, 0.95);
    const alongX = road.x2 - road.x1 > road.z2 - road.z1;
    const side = rng.next() < 0.5 ? 1 : -1;
    const off = road.width / 2 + 2.5;
    const x = alongX ? road.x1 + (road.x2 - road.x1) * t : road.x1 + off * side;
    const z = alongX ? road.z1 + off * side : road.z1 + (road.z2 - road.z1) * t;
    if (insideBuilding(x, z, hash)) continue;
    const s = rng.range(0.8, 1.35);
    q.setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));
    m4.compose(pos.set(x, 0.2, z), q, scl.set(s, s * rng.range(0.9, 1.3), s));
    trunks.setMatrixAt(palms, m4);
    fronds.setMatrixAt(palms, m4);
    palms++;
  }
  trunks.count = palms;
  fronds.count = palms;
  trunks.castShadow = true;
  root.add(trunks, fronds);

  // ---- Billboards: canvas-textured signs on poles near major roads ------
  const brands = ['SKYFORGE', 'DRIFT.KING', 'NOVA-X1', 'FOO-XL FUEL', 'APEX TYRES', 'HOVER-INN'];
  const bbGeo = new THREE.BoxGeometry(14, 7, 0.6);
  const poleGeo = new THREE.CylinderGeometry(0.35, 0.35, 9, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.7, metalness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const road = roads[(i * 7) % roads.length] as RoadSegment;
    const t = 0.25 + (i % 4) * 0.18;
    const alongX = road.x2 - road.x1 > road.z2 - road.z1;
    const x = alongX ? road.x1 + (road.x2 - road.x1) * t : road.x1 + 12;
    const z = alongX ? road.z1 + 12 : road.z1 + (road.z2 - road.z1) * t;
    if (insideBuilding(x, z, hash)) continue;

    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
    if (ctx) {
      const bg = ['#0f172a', '#1e1b4b', '#052e16', '#450a0a'][i % 4] as string;
      const fg = ['#22d3ee', '#e879f9', '#4ade80', '#f87171'][i % 4] as string;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 512, 256);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, 484, 228);
      ctx.fillStyle = fg;
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(brands[i % brands.length] as string, 256, 128);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 });
    const sign = new THREE.Mesh(bbGeo, [signMat, signMat, signMat, signMat, signMat, signMat]);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    sign.position.set(x, 13, z);
    sign.rotation.y = alongX ? 0 : Math.PI / 2;
    pole.position.set(x, 4.5, z);
    sign.castShadow = true;
    root.add(sign, pole);
  }

  return { root, ramps, rings };
}
