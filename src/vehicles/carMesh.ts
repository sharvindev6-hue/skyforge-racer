import * as THREE from 'three';
import type { CarSpec } from './physics';

export interface CarMeshResult {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  /** Wings/thrusters that deploy in flight mode (scale 0 -> 1). */
  wings: THREE.Group;
  headlights: THREE.Mesh[];
  taillights: THREE.Mesh[];
}

/** Silhouette parameters per style. */
const STYLES: Record<
  CarSpec['style'],
  { body: [number, number, number]; cabin: [number, number, number]; nose: number; wing: 'small' | 'big' | 'none'; ride: number }
> = {
  sport: { body: [1.9, 0.55, 4.4], cabin: [1.6, 0.5, 2.0], nose: 0.9, wing: 'small', ride: 0.32 },
  muscle: { body: [2.05, 0.7, 5.0], cabin: [1.7, 0.55, 1.8], nose: 1.2, wing: 'none', ride: 0.38 },
  super: { body: [2.0, 0.45, 4.6], cabin: [1.5, 0.4, 1.7], nose: 1.1, wing: 'big', ride: 0.26 },
};

/**
 * Builds a procedural car from primitives. Player car gets real lights;
 * wheels are exposed for spin/steer animation, wings for mode transforms.
 */
export function buildCarMesh(spec: CarSpec, colorIndex = 0, isPlayer = true): CarMeshResult {
  const st = STYLES[spec.style];
  const group = new THREE.Group();
  group.name = `car:${spec.id}`;

  const color = spec.colors[colorIndex % spec.colors.length] as number;
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.65, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.4, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0e2233,
    metalness: 0.9,
    roughness: 0.12,
    transparent: true,
    opacity: 0.82,
  });

  // Chassis: bevelled lower body + upper body slab.
  const lower = new THREE.Mesh(new THREE.BoxGeometry(st.body[0], st.body[1], st.body[2]), paint);
  lower.position.y = st.ride + st.body[1] / 2;
  lower.castShadow = true;
  group.add(lower);

  const upper = new THREE.Mesh(
    new THREE.BoxGeometry(st.body[0] * 0.94, st.body[1] * 0.55, st.body[2] * 0.86),
    paint,
  );
  upper.position.y = st.ride + st.body[1] + st.body[1] * 0.26;
  upper.castShadow = true;
  group.add(upper);

  // Nose wedge (tapered box via scaled geometry).
  const nose = new THREE.Mesh(new THREE.BoxGeometry(st.body[0] * 0.9, st.body[1] * 0.7, st.nose), paint);
  nose.position.set(0, st.ride + st.body[1] * 0.55, st.body[2] / 2 + st.nose / 2 - 0.1);
  nose.scale.y = 0.6;
  group.add(nose);

  // Cabin glass.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(st.cabin[0], st.cabin[1], st.cabin[2]), glass);
  cabin.position.set(0, st.ride + st.body[1] * 1.28, -st.body[2] * 0.12);
  cabin.castShadow = true;
  group.add(cabin);

  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.28, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Mesh[] = [];
  const wx = st.body[0] / 2 - 0.12;
  const wz = st.body[2] / 2 - 0.55;
  for (const [sx, sz] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ] as const) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.position.set(sx * wx, 0.35, sz * wz);
    w.castShadow = true;
    group.add(w);
    wheels.push(w);
  }

  // Wing.
  const wings = new THREE.Group();
  wings.name = 'wings';
  wings.visible = false;
  if (st.wing !== 'none') {
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x16181d, metalness: 0.6, roughness: 0.4 });
    const plane = new THREE.Mesh(new THREE.BoxGeometry(st.body[0] * 1.05, 0.08, 0.5), wingMat);
    plane.position.set(0, st.ride + st.body[1] + 0.45, -st.body[2] / 2 - 0.15);
    plane.castShadow = true;
    const struts = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.1), wingMat);
    struts.position.set(0, st.ride + st.body[1] + 0.22, -st.body[2] / 2 - 0.15);
    wings.add(plane, struts);
    group.add(wings);
  }

  // Jet thrusters (glow in flight).
  const thrustMat = new THREE.MeshStandardMaterial({
    color: 0x101418,
    emissive: 0x22d3ee,
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const thrusters = new THREE.Group();
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.5, 10), thrustMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(sx * 0.55, st.ride + st.body[1] * 0.5, -st.body[2] / 2 - 0.2);
    thrusters.add(t);
  }
  group.add(thrusters);

  // Headlights + taillights (emissive strips; player also gets spot lights).
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff7d6, emissiveIntensity: isPlayer ? 2.2 : 1.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff2020, emissiveIntensity: isPlayer ? 1.8 : 1.0 });
  const headlights: THREE.Mesh[] = [];
  const taillights: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), headMat);
    h.position.set(sx * 0.6, st.ride + st.body[1] * 0.6, st.body[2] / 2 + st.nose - 0.12);
    group.add(h);
    headlights.push(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.06), tailMat);
    t.position.set(sx * 0.62, st.ride + st.body[1] * 0.8, -st.body[2] / 2 - 0.02);
    group.add(t);
    taillights.push(t);
  }
  if (isPlayer) {
    for (const sx of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff2cc, 60, 90, 0.5, 0.5, 1.2);
      spot.position.set(sx * 0.6, st.ride + 0.4, st.body[2] / 2);
      const target = new THREE.Object3D();
      target.position.set(sx * 0.6, 0, st.body[2] / 2 + 18);
      group.add(target);
      spot.target = target;
      group.add(spot);
    }
  }

  return { group, wheels, wings, headlights, taillights };
}
