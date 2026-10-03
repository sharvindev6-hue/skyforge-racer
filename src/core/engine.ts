import * as THREE from 'three';

/**
 * Owns the WebGL renderer, scene, camera and the fixed-step game loop.
 * Physics/updates run at a fixed 120 Hz tick; rendering happens once per RAF.
 */
export class Engine {
  readonly world = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly stats = { fps: 0, calls: 0 };

  private raf = 0;
  private last = 0;
  private acc = 0;
  private readonly frameCbs: Array<(dt: number, t: number) => void> = [];
  private readonly FIXED = 1 / 120;
  private readonly MAX_SUBSTEPS = 5;
  private readonly resize: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
    this.resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  onFrame(cb: (dt: number, elapsed: number) => void): void {
    this.frameCbs.push(cb);
  }

  start(): void {
    this.last = performance.now();
    const tick = (now: number) => {
      this.raf = requestAnimationFrame(tick);
      const frameDt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.acc += frameDt;
      let steps = 0;
      while (this.acc >= this.FIXED && steps < this.MAX_SUBSTEPS) {
        for (const cb of this.frameCbs) cb(this.FIXED, now / 1000);
        this.acc -= this.FIXED;
        steps++;
      }
      this.renderer.render(this.world, this.camera);
      this.stats.fps = Math.round(1 / Math.max(frameDt, 1e-4));
      this.stats.calls = this.renderer.info.render.calls;
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.resize);
    this.world.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }
}
