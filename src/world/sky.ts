import * as THREE from 'three';

export interface SkyResult {
  /** Call once per frame with elapsed seconds. Drives sun position + colors. */
  update(t: number): void;
  sun: THREE.DirectionalLight;
  /** 0 = midnight, 1 = noon. */
  daylight: number;
}

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SKY_FRAG = `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
void main() {
  float y = vDir.y;
  if (y >= 0.0) {
    gl_FragColor = vec4(mix(uHorizon, uZenith, pow(y, 0.6)), 1.0);
  } else {
    gl_FragColor = vec4(mix(uHorizon, uGround, pow(-y, 0.5)), 1.0);
  }
}
`;

const CYCLE_SECONDS = 600; // 10-minute full day

export function buildSky(parent: THREE.Object3D, scene?: THREE.Scene): SkyResult {
  // Gradient dome.
  const uniforms = {
    uZenith: { value: new THREE.Color(0x1a3a6e) },
    uHorizon: { value: new THREE.Color(0x87b5e0) },
    uGround: { value: new THREE.Color(0x2a3038) },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 24, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.name = 'skydome';
  parent.add(dome);

  // Stars (visible at night).
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(800 * 3);
  let si = 0;
  const srand = () => Math.random();
  for (let i = 0; i < 800; i++) {
    const theta = srand() * Math.PI * 2;
    const phi = Math.acos(srand() * 0.9); // upper hemisphere biased
    const r = 3400;
    starPos[si++] = r * Math.sin(phi) * Math.cos(theta);
    starPos[si++] = r * Math.cos(phi);
    starPos[si++] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 6, sizeAttenuation: true, transparent: true, opacity: 0, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'stars';
  parent.add(stars);

  // Lights.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -400;
  sun.shadow.camera.right = 400;
  sun.shadow.camera.top = 400;
  sun.shadow.camera.bottom = -400;
  sun.shadow.camera.far = 2500;
  sun.shadow.bias = -0.0004;
  parent.add(sun);
  const hemi = new THREE.HemisphereLight(0xbdd7ff, 0x3a4633, 0.7);
  parent.add(hemi);

  // Fog matched to horizon (only when a real scene is available).
  if (scene) scene.fog = new THREE.Fog(0x87b5e0, 300, 2600);
  const fog = scene?.fog as THREE.Fog | undefined;

  const zen = new THREE.Color();
  const hor = new THREE.Color();
  const result: SkyResult = {
    sun,
    daylight: 1,
    update(t: number) {
      const dayPhase = ((t / CYCLE_SECONDS) % 1 + 1) % 1; // 0..1, 0 = midnight
      const sunAngle = dayPhase * Math.PI * 2 - Math.PI / 2; // -PI/2 at midnight
      const elev = Math.sin(sunAngle); // -1..1
      result.daylight = THREE.MathUtils.clamp(elev * 2 + 0.5, 0, 1);

      // Sun orbits in the X-Y plane, tilted toward Z.
      const dist = 2200;
      sun.position.set(Math.cos(sunAngle) * dist * 0.9, elev * dist, dist * 0.35);
      sun.intensity = Math.max(elev, 0) * 2.2 + 0.05;
      const warm = THREE.MathUtils.clamp(1 - Math.abs(elev) * 2.5, 0, 1); // sunrise/sunset
      sun.color.setRGB(1, 1 - warm * 0.35, 1 - warm * 0.6);

      hemi.intensity = 0.25 + result.daylight * 0.5;
      starMat.opacity = THREE.MathUtils.clamp(1 - result.daylight * 2.2, 0, 0.9);

      // Sky palette: night -> sunrise -> noon.
      const noonZen = new THREE.Color(0x2a5cb8);
      const noonHor = new THREE.Color(0x9ec8ec);
      const nightZen = new THREE.Color(0x05070f);
      const nightHor = new THREE.Color(0x101828);
      const duskZen = new THREE.Color(0x3a2a5e);
      const duskHor = new THREE.Color(0xe8825a);
      const dl = result.daylight;
      if (dl < 0.5) {
        const k = dl / 0.5; // 0 night -> 1 dusk-edge
        zen.lerpColors(nightZen, duskZen, k);
        hor.lerpColors(nightHor, duskHor, k * 0.85);
      } else {
        const k = (dl - 0.5) / 0.5;
        zen.lerpColors(duskZen, noonZen, k);
        hor.lerpColors(duskHor, noonHor, k);
      }
      uniforms.uZenith.value.copy(zen);
      uniforms.uHorizon.value.copy(hor);
      if (fog) {
        fog.color.copy(hor);
        fog.near = 300 + dl * 200;
      }
    },
  };
  result.update(120); // start mid-morning
  return result;
}
