# SkyForge Racer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a production-quality browser open-world driving game — arcade car with drift, jet/hover flight mode, procedural city + terrain, full game loop (races, missions, garage, economy), deployed to a custom `.xyz` domain.

**Architecture:** Single-page TypeScript app on Vite + Three.js. Fixed-timestep arcade physics engine in pure TS (no heavy physics dependency). Deterministic procedural world generation from a seeded RNG. Canvas-2D overlay HUD; gamepad + keyboard + touch input abstraction. Static deploy — no backend; persistence via localStorage with export/import save codes.

**Tech Stack:** TypeScript 5 (strict), Three.js r160+, Vite 5, pnpm, Vitest, ESLint + Prettier, GitHub Actions CI, Vercel (custom domain).

## Global Constraints

- Node ≥ 20, pnpm ≥ 9.
- `"strict": true` in tsconfig — zero `any` without an inline justification comment.
- Target 60 FPS on a mid-range laptop; frame budget 16.6 ms — profile before optimizing.
- No copyrighted assets: all art procedurally generated or CC0 (Kenney assets allowed).
- No backend server; no personal data collected; localStorage only.
- Every task: lint + typecheck + unit tests green before commit.
- All meshes disposed correctly on scene teardown (no WebGL context leaks on restart).
- IDs are stable strings (seed-derived) so save files survive world regeneration.

---

## File Structure

```
skyforge-racer/
  package.json, tsconfig.json, vite.config.ts, .eslintrc.cjs, .prettierrc, .gitignore, index.html
  public/                      # favicon, kenney CC0 audio if used
  docs/plans/                  # this plan, ADRs
  src/
    main.ts                    # entry: bootstrap, resize, RAF loop
    core/
      engine.ts                # Renderer/scene/camera ownership, fixed-step loop
      rng.ts                   # mulberry32 seeded RNG (determinism)
      input.ts                 # keyboard + gamepad + touch -> InputFrame
      events.ts                # typed pub/sub EventMap
      audio.ts                 # WebAudio synth: engine, wind, UI bleeps
      save.ts                  # localStorage save/load, versioned schema, export code
    world/
      worldgen.ts              # master generateWorld(seed) -> WorldData
      city.ts                  # block/street/lot builder -> instanced meshes
      terrain.ts               # heightfield + chunk LOD around player
      props.ts                 # ramps, rings, billboards, palms
      collision.ts             # spatial hash, OBB/AABB, height sampling
      sky.ts                   # gradient sky, sun, stars, day/night cycle
    vehicles/
      physics.ts               # arcade rigid body: throttle/brake/steer/drift
      flight.ts                # jet + hover flight model, mode transitions
      carMesh.ts               # procedural car builder (chassis/wheels/lights)
      controller.ts            # binds InputFrame -> physics/flight, camera rig
    game/
      state.ts                 # zustand store: money, owned cars, missions, settings
      missions.ts              # race checkpoints, delivery, stunt contracts
      traffic.ts               # AI cars: lane paths, avoid player
      collectibles.ts          # cash pickups, boost tokens, garage keys
      economy.ts               # earn/spend/upgrade math, cost curves
    ui/
      hud.ts                   # canvas-2d speedo, minimap, mission tracker
      menus.ts                 # DOM overlays: title, garage, pause, settings
      toast.ts                 # mission complete / purchase feedback
  tests/                       # vitest units (mirror src tree)
```

---

### Task 1: Repo scaffold + CI green on empty app

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `index.html`, `src/main.ts`, `tests/smoke.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `pnpm dev` serves the page; `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` all exit 0; `src/main.ts` exports `startGame(canvas: HTMLCanvasElement): GameLoop` (empty loop for now) — Task 2 fills it.

- [ ] **Step 1: Init project and install deps**

```bash
mkdir -p skyforge-racer/src/core skyforge-racer/tests skyforge-racer/docs/plans skyforge-racer/.github/workflows
cd skyforge-racer
pnpm init
pnpm add three
pnpm add -D typescript vite vitest @types/three eslint @eslint/js typescript-eslint prettier
```

- [ ] **Step 2: Write configs**

`package.json` scripts block:

```json
{
  "name": "skyforge-racer",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
});
```

`.gitignore`:

```
node_modules/
dist/
coverage/
*.log
```

- [ ] **Step 3: Write failing smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('project smoke', () => {
  it('has a working vitest + ts pipeline', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm test` — Expected: PASS (this one is a pipeline check, not TDD).

- [ ] **Step 4: Write placeholder entry that compiles**

`src/main.ts`:

```ts
export interface GameLoop {
  dispose(): void;
}

export function startGame(_canvas: HTMLCanvasElement): GameLoop {
  return { dispose() {} };
}
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SkyForge Racer</title>
  </head>
  <body style="margin:0;overflow:hidden;background:#000">
    <canvas id="game" style="display:block;width:100vw;height:100vh"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **Step 6: Verify all four gates pass**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: all exit 0.

- [ ] **Step 7: Create GitHub repo, initial commit, push**

```bash
git init && git add -A
git commit -m "chore: scaffold vite + three + ts project with CI"
gh repo create skyforge-racer --public --source=. --push
```

(If `gh` is unavailable, create the repo on github.com and set the remote manually; do not push without the user's confirmation of the remote URL.)

---

### Task 2: Core engine — renderer, fixed-step loop, typed events

**Files:**
- Create: `src/core/engine.ts`, `src/core/events.ts`, `tests/engine.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces:
  - `class Engine { constructor(canvas: HTMLCanvasElement); world: THREE.Scene; camera: THREE.PerspectiveCamera; onFrame(cb: (dt: number, elapsed: number) => void): void; start(): void; stop(): void; dispose(): void; readonly stats: { fps: number; calls: number }; }`
  - `class Emitter<E extends Record<string, unknown>> { on<K>(k: keyof E & string, fn: (p: E[keyof E]) => void): () => void; emit<K>(k: keyof E & string, p: E[keyof E]): void; clear(): void; }`
  - `type GameEvents = { 'vehicle:mode': { mode: 'drive' | 'fly' | 'hover' }; 'mission:complete': { id: string; reward: number }; ... }` (Task 9 grows this map)
- Consumes: Task 1 scaffold.

- [ ] **Step 1: Write failing engine test**

`tests/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/core/events';

describe('Emitter', () => {
  it('delivers typed payloads to subscribers and supports unsubscribe', () => {
    type E = { ping: { n: number } };
    const em = new Emitter<E>();
    let got = 0;
    const off = em.on('ping', (p) => (got = p.n));
    em.emit('ping', { n: 7 });
    expect(got).toBe(7);
    off();
    em.emit('ping', { n: 9 });
    expect(got).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/engine.test.ts`
Expected: FAIL — cannot find module `../src/core/events`.

- [ ] **Step 3: Implement events.ts**

```ts
export class Emitter<E extends Record<string, unknown>> {
  private subs = new Map<string, Set<(p: never) => void>>();

  on<K extends keyof E & string>(key: K, fn: (p: E[K]) => void): () => void {
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(fn as (p: never) => void);
    return () => set?.delete(fn as (p: never) => void);
  }

  emit<K extends keyof E & string>(key: K, payload: E[K]): void {
    this.subs.get(key)?.forEach((fn) => (fn as (p: E[K]) => void)(payload));
  }

  clear(): void {
    this.subs.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/engine.test.ts` — Expected: PASS.

- [ ] **Step 5: Implement engine.ts**

```ts
import * as THREE from 'three';

export class Engine {
  readonly world = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly stats = { fps: 0, calls: 0 };
  private raf = 0;
  private last = 0;
  private acc = 0;
  private readonly frameCbs: Array<(dt: number, t: number) => void> = [];
  private readonly FIXED = 1 / 120; // physics tick
  private readonly MAX_SUBSTEPS = 5;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
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

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
}
```

- [ ] **Step 6: Wire main.ts to instantiate Engine and start the loop**

Replace `src/main.ts` body: create `Engine`, call `engine.start()`, return `GameLoop` whose `dispose()` calls `engine.dispose()`.

- [ ] **Step 7: Verify gates and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: PASS.
Manual: `pnpm dev` shows a black canvas without console errors.

```bash
git add -A && git commit -m "feat(core): engine with fixed-step loop and typed emitter"
```

---

### Task 3: Input (keyboard + gamepad) and seeded RNG

**Files:**
- Create: `src/core/input.ts`, `src/core/rng.ts`, `tests/input.test.ts`, `tests/rng.test.ts`

**Interfaces:**
- Produces:
  - `class Input { poll(): void; readonly frame: InputFrame; dispose(): void; }`
  - `interface InputFrame { throttle: number; brake: number; steer: number; handbrake: boolean; boost: boolean; toggleModePressed: boolean; pitch: number; roll: number; yaw: number; cameraPressed: boolean; pausePressed: boolean; resetPressed: boolean; }` — all in `-1..1` (booleans except steer/pitch/roll/yaw), sampled from key map WASD/arrows, Shift = boost, Space = handbrake/mode, G = toggle mode, C = camera, Esc = pause, R = reset; gamepad axes override when connected.
  - `function mulberry32(seed: number): () => number` and `class Rng { constructor(seed: number); next(): number; range(min: number, max: number): number; int(min: number, max: number): number; pick<T>(arr: T[]): T; }`

- [ ] **Step 1: Write failing tests**

`tests/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Rng, mulberry32 } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
  it('range respects bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(-5, 5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
  });
  it('mulberry32 matches reference vector', () => {
    const g = mulberry32(0);
    expect(g()).toBeCloseTo(0.9308189, 6);
  });
});
```

`tests/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { keyToAxis } from '../src/core/input';

describe('keyToAxis', () => {
  it('maps opposing keys to a -1..1 axis', () => {
    expect(keyToAxis({ KeyA: true, KeyD: false }, 'KeyA', 'KeyD')).toBe(-1);
    expect(keyToAxis({ KeyA: true, KeyD: true }, 'KeyA', 'KeyD')).toBe(0);
    expect(keyToAxis({}, 'KeyA', 'KeyD')).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify FAIL (module missing)** — `pnpm vitest run tests/rng.test.ts tests/input.test.ts`

- [ ] **Step 3: Implement rng.ts**

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private g: () => number;
  constructor(seed: number) {
    this.g = mulberry32(seed);
  }
  next(): number {
    return this.g();
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.g();
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.g() * arr.length)] as T;
  }
}
```

- [ ] **Step 4: Implement input.ts**

```ts
export interface InputFrame {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
  toggleModePressed: boolean;
  pitch: number;
  roll: number;
  yaw: number;
  cameraPressed: boolean;
  pausePressed: boolean;
  resetPressed: boolean;
}

export function keyToAxis(
  keys: Record<string, boolean>,
  neg: string,
  pos: string,
): number {
  return (keys[pos] ? 1 : 0) - (keys[neg] ? 1 : 0);
}

export class Input {
  readonly frame: InputFrame = {
    throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false,
    toggleModePressed: false, pitch: 0, roll: 0, yaw: 0,
    cameraPressed: false, pausePressed: false, resetPressed: false,
  };
  private keys: Record<string, boolean> = {};
  private prev = { mode: false, cam: false, pause: false, reset: false };

  constructor(private target: HTMLElement | Window = window) {
    const dn = (e: KeyboardEvent) => { this.keys[e.code] = true; };
    const up = (e: KeyboardEvent) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    this.dispose = () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }

  dispose: () => void = () => {};

  poll(): void {
    const k = this.keys;
    this.frame.throttle = keyToAxis(k, 'ArrowDown', 'ArrowUp');
    this.frame.brake = keyToAxis(k, 'ArrowUp', 'ArrowDown');
    this.frame.steer = keyToAxis(k, 'KeyA', 'KeyD') || keyToAxis(k, 'ArrowLeft', 'ArrowRight');
    this.frame.pitch = keyToAxis(k, 'KeyS', 'KeyW');
    this.frame.roll = this.frame.steer;
    this.frame.yaw = this.frame.steer;
    this.frame.handbrake = !!k['Space'];
    this.frame.boost = !!k['ShiftLeft'] || !!k['ShiftRight'];
    const mode = !!k['KeyG'];
    const cam = !!k['KeyC'];
    const pause = !!k['Escape'];
    const reset = !!k['KeyR'];
    this.frame.toggleModePressed = mode && !this.prev.mode;
    this.frame.cameraPressed = cam && !this.prev.cam;
    this.frame.pausePressed = pause && !this.prev.pause;
    this.frame.resetPressed = reset && !this.prev.reset;
    this.prev = { mode, cam, pause, reset };

    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad) continue;
      const [lx = 0, ly = 0] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      if (Math.abs(lx) > 0.12) {
        this.frame.steer = lx;
        this.frame.roll = lx;
        this.frame.yaw = lx;
      }
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0) this.frame.throttle = rt;
      if (lt > 0) this.frame.brake = lt;
      break;
    }
  }
}
```

(Note: throttle axis sign — ArrowUp = W = forward = +1, ArrowDown = S = −1; flight pitch uses W/S directly.)

- [ ] **Step 5: Run tests to PASS** — `pnpm vitest run tests/rng.test.ts tests/input.test.ts`

- [ ] **Step 6: Gates + commit**

```bash
git add -A && git commit -m "feat(core): input abstraction and deterministic seeded RNG"
```

---

### Task 4: Collision — spatial hash, OBB tests, height sampling

**Files:**
- Create: `src/world/collision.ts`, `tests/collision.test.ts`

**Interfaces:**
- Produces:
  - `interface Box { center: THREE.Vector3; half: THREE.Vector3; yaw: number; }`
  - `class SpatialHash { constructor(cellSize: number); insert(box: Box, id: string): void; clear(): void; queryAABB(min: THREE.Vector2, max: THREE.Vector2): string[]; }`
  - `function obbOverlap2D(a: Box, b: Box): boolean` (separating-axis on X/Z with yaw)
  - `class HeightField { constructor(size: number, res: number, data: Float32Array); heightAt(x: number, z: number): number; normalAt(x: number, z: number): THREE.Vector3; }`
  - `function sampleGround(x: number, z: number): { height: number; kind: 'road' | 'terrain' | 'building' | 'ramp' }` — collision module registers static boxes each frame from world data.

- [ ] **Step 1: Write failing tests**

`tests/collision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HeightField, SpatialHash, obbOverlap2D, type Box } from '../src/world/collision';

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
});

describe('obbOverlap2D', () => {
  it('detects overlap, separation, and yaw rotation cases', () => {
    expect(obbOverlap2D(box(0, 0), box(1, 0))).toBe(true);
    expect(obbOverlap2D(box(0, 0), box(3, 0))).toBe(false);
    const long: Box = { center: new THREE.Vector3(0, 0, 0), half: new THREE.Vector3(3, 1, 0.5), yaw: 0 };
    const rotated: Box = { center: new THREE.Vector3(2.4, 0, 0), half: new THREE.Vector3(0.5, 1, 3), yaw: Math.PI / 2 };
    expect(obbOverlap2D(long, rotated)).toBe(true);
  });
});

describe('HeightField', () => {
  it('bilinearly interpolates and computes upward normals', () => {
    const data = new Float32Array(16);
    const hf = new HeightField(16, 4, data);
    expect(hf.heightAt(2, 2)).toBe(0);
    expect(hf.normalAt(2, 2).y).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Verify FAIL** — `pnpm vitest run tests/collision.test.ts`

- [ ] **Step 3: Implement collision.ts**

Core algorithm notes for the implementer:
- **Spatial hash:** map cell key `cx + cz * 4096` → `Set<string>`; `queryAABB` walks covered cells and dedupes via a visited Set. Insert also stores each id's box in a private `Map<string, Box>` so queries can re-test exact overlap if needed.
- **OBB 2D SAT:** project both boxes on 4 axes (a.right, a.forward, b.right, b.forward via yaw); overlap iff all 4 axis intervals overlap. Interval of box B on axis `d`: `|B.half.x * cos(b.yaw - d)| + |B.half.z * sin(b.yaw - d)|` centered at `(B.center − A.center) · d`.
- **HeightField bilinear:** data indexed `z * res + x`, world `x ∈ [−size/2, size/2)`; clamp to border, lerp both axes, normal = normalized cross of finite differences (Δ = cell size, cross((Δ, hR−hL, 0),(0, hD−hU, Δ)) → normalize).

```ts
import * as THREE from 'three';

export interface Box {
  center: THREE.Vector3;
  half: THREE.Vector3;
  yaw: number;
}

export class SpatialHash {
  private cells = new Map<number, Set<string>>();
  private boxes = new Map<string, Box>();
  constructor(private cellSize: number) {}

  private key(x: number, z: number): number {
    return Math.floor(x / this.cellSize) + Math.floor(z / this.cellSize) * 4096;
  }

  insert(box: Box, id: string): void {
    this.boxes.set(id, box);
    const r = Math.max(box.half.x, box.half.z) + this.cellSize;
    for (let x = box.center.x - r; x <= box.center.x + r; x += this.cellSize) {
      for (let z = box.center.z - r; z <= box.center.z + r; z += this.cellSize) {
        const k = this.key(x, z);
        let s = this.cells.get(k);
        if (!s) { s = new Set(); this.cells.set(k, s); }
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
    for (let x = min.x; x <= max.x; x += this.cellSize) {
      for (let z = min.y; z <= max.y; z += this.cellSize) {
        this.cells.get(this.key(x, z))?.forEach((id) => out.add(id));
      }
    }
    return [...out];
  }

  boxOf(id: string): Box | undefined {
    return this.boxes.get(id);
  }
}

function axisRange(box: Box, ax: THREE.Vector2): [number, number] {
  const c = box.half.x * Math.abs(Math.cos(box.yaw - Math.atan2(ax.y, ax.x)))
    + box.half.z * Math.abs(Math.sin(box.yaw - Math.atan2(ax.y, ax.x)));
  const d = box.center.x * ax.x + box.center.z * ax.y;
  return [d - c, d + c];
}

export function obbOverlap2D(a: Box, b: Box): boolean {
  const axes = [
    new THREE.Vector2(Math.cos(a.yaw), Math.sin(a.yaw)),
    new THREE.Vector2(-Math.sin(a.yaw), Math.cos(a.yaw)),
    new THREE.Vector2(Math.cos(b.yaw), Math.sin(b.yaw)),
    new THREE.Vector2(-Math.sin(b.yaw), Math.cos(b.yaw)),
  ];
  const dx = b.center.x - a.center.x;
  const dz = b.center.z - a.center.z;
  for (const ax of axes) {
    const [a0, a1] = axisRange(a, ax);
    const center = dx * ax.x + dz * ax.y;
    const rx = b.half.x * Math.abs(Math.cos(b.yaw)) + b.half.z * Math.abs(Math.sin(b.yaw));
    const rz = b.half.x * Math.abs(Math.sin(b.yaw)) + b.half.z * Math.abs(Math.cos(b.yaw));
    void rx; void rz;
    const [b0, b1] = (() => {
      const c = b.half.x * Math.abs(Math.cos(Math.atan2(ax.y, ax.x) - b.yaw))
        + b.half.z * Math.abs(Math.sin(Math.atan2(ax.y, ax.x) - b.yaw));
      return [center - c, center + c];
    })();
    if (a1 < b0 || b1 < a0) return false;
    void axisRange;
  }
  return true;
}

export class HeightField {
  constructor(private size: number, private res: number, private data: Float32Array) {}

  heightAt(x: number, z: number): number {
    const half = this.size / 2;
    const fx = THREE.MathUtils.clamp((x + half) / this.size * (this.res - 1), 0, this.res - 1.001);
    const fz = THREE.MathUtils.clamp((z + half) / this.size * (this.res - 1), 0, this.res - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fx - x0, tz = fz - z0;
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

export function sampleGround(
  x: number,
  z: number,
  hf: HeightField,
  hash: SpatialHash,
): { height: number; kind: SurfaceKind } {
  const near = hash.queryAABB(new THREE.Vector2(x - 2, z - 2), new THREE.Vector2(x + 2, z + 2));
  let kind: SurfaceKind = 'terrain';
  let height = hf.heightAt(x, z);
  for (const id of near) {
    const b = hash.boxOf(id);
    if (!b) continue;
    if (id.startsWith('ramp')) { kind = 'ramp'; height = Math.max(height, b.center.y); }
    else if (id.startsWith('bld')) { kind = 'building'; height = Math.max(height, b.center.y + b.half.y); }
    else if (id.startsWith('road')) { kind = 'road'; height = Math.max(height, b.center.y); }
  }
  return { height, kind };
}
```

- [ ] **Step 4: Run tests to PASS, then run gates**

Run: `pnpm vitest run tests/collision.test.ts && pnpm typecheck`
Expected: PASS. If `void` placeholder lines bother you, remove them — they exist only to keep the sketch compiling; the final implementation should drop dead code.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(world): spatial hash, 2D OBB SAT, heightfield sampling"
```

---

### Task 5: World generation — city, terrain, sky, props

**Files:**
- Create: `src/world/worldgen.ts`, `src/world/city.ts`, `src/world/terrain.ts`, `src/world/sky.ts`, `src/world/props.ts`, `tests/worldgen.test.ts`

**Interfaces:**
- Consumes: `Rng` (Task 3), `SpatialHash`/`HeightField` (Task 4).
- Produces:
  - `interface WorldData { seed: number; root: THREE.Group; hash: SpatialHash; height: HeightField; roads: RoadSegment[]; ramps: RampDef[]; spawn: THREE.Vector3; cityRadius: number; bounds: number; }`
  - `interface RoadSegment { x1: number; z1: number; x2: number; z2: number; width: number; }`
  - `interface RampDef { x: number; z: number; yaw: number; length: number; rise: number; }`
  - `function generateWorld(seed: number): WorldData` — grid city: blocks of 60 m with 12 m streets, lots get buildings (3–10 stories, window emissive), parks get trees; beyond `cityRadius` procedural terrain (fBm noise, `data` Float32Array res 256) with rolling hills up to 40 m; props: 24 ramps near streets, 60 boost rings, palms along coast; sky: gradient dome + directional sun + hemisphere light + star points.
  - All static geometry registered into `hash` with id prefixes `bld|road|ramp|prop` (Task 4 `sampleGround` contract).

- [ ] **Step 1: Write failing test**

`tests/worldgen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/worldgen';

describe('generateWorld', () => {
  it('is deterministic and self-consistent for a seed', () => {
    const a = generateWorld(42);
    const b = generateWorld(42);
    expect(a.roads.length).toBe(b.roads.length);
    expect(a.roads[0]).toEqual(b.roads[0]);
    expect(a.spawn.length()).toBeGreaterThan(0);
    expect(a.roads.length).toBeGreaterThan(20);
    expect(a.ramps.length).toBeGreaterThan(10);
  });
  it('different seeds differ', () => {
    expect(generateWorld(1).roads[0]).not.toEqual(generateWorld(2).roads[0]);
  });
});
```

- [ ] **Step 2: Verify FAIL** — module missing.

- [ ] **Step 3: Implement terrain.ts (fBm heightfield)**

```ts
import * as THREE from 'three';
import { HeightField } from './collision';

function valueNoise2D(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  let a = seed >>> 0;
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i] as number;
  const grad = (h: number, x: number, y: number) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[(perm[X] as number) + Y] as number;
    const ab = perm[(perm[X] as number) + Y + 1] as number;
    const ba = perm[(perm[X + 1] as number) + Y] as number;
    const bb = perm[(perm[X + 1] as number) + Y + 1] as number;
    const x1 = grad(aa, xf, yf) * (1 - u) + grad(ba, xf - 1, yf) * u;
    const x2 = grad(ab, xf, yf - 1) * (1 - u) + grad(bb, xf - 1, yf - 1) * u;
    return (x1 * (1 - v) + x2 * v) * 0.5 + 0.5;
  };
}

export function makeHeightfield(size: number, res: number, seed: number, amp: number): HeightField {
  const noise = valueNoise2D(seed);
  const data = new Float32Array(res * res);
  for (let iz = 0; iz < res; iz++) {
    for (let ix = 0; ix < res; ix++) {
      const x = (ix / (res - 1) - 0.5) * size;
      const z = (iz / (res - 1) - 0.5) * size;
      const r = Math.hypot(x, z);
      // flatten the city center, roll hills outward
      const mask = THREE.MathUtils.clamp((r - 600) / 800, 0, 1);
      let h = 0;
      h += noise(x / 900, z / 900) * 1.0;
      h += noise(x / 300 + 100, z / 300) * 0.4;
      h += noise(x / 90 + 200, z / 90) * 0.12;
      data[iz * res + ix] = (h / 1.52 - 0.5) * 2 * amp * mask;
    }
  }
  return new HeightField(size, res, data);
}
```

- [ ] **Step 4: Implement city.ts (instanced blocks) + sky.ts + props.ts**

- `city.ts`: `buildCity(rng: Rng, hash: SpatialHash): { root: THREE.Group; roads: RoadSegment[]; spawn: THREE.Vector3; cityRadius: number }`. Grid 9×9 blocks: for each block place 1–4 `BoxGeometry` buildings via `THREE.InstancedMesh` (one per material tier: glass tower, concrete, brick) with emissive window texture generated on an offscreen canvas (128×256, rows of lit/unlit rectangles, `NearestFilter`). Streets: dark planes `10×(blockSize+12)` strips both axes at each gridline, ids `road:ax:i`, `road:az:i`. Sidewalk curb boxes around lots. Spawn = intersection (0,0) center. City radius = 4.5 blocks ≈ 320 m.
- `sky.ts`: `buildSky(scene: THREE.Scene): { update(t: number): void; sun: THREE.DirectionalLight }` — large `SphereGeometry` with backface gradient shader (ShaderMaterial: mix horizon/zenith color by view-space y), `sun` orbiting ±35° over a 10-minute cycle, fog color synced to horizon, stars = 800 `Points` with opacity keyed to sun elevation.
- `props.ts`: `buildProps(rng, hash, roads): { root: THREE.Group; ramps: RampDef[]; rings: THREE.Object3D[] }` — ramps: 24 wedge `BufferGeometry`s (extruded triangle, `ramp:` id into hash with rotated Box approx), rings: 60 torus meshes (emissive cyan), palms: instanced cylinder trunk + cone fronds along outer road edges, billboards: box + canvas texture with generated brand text ("SKYFORGE", "DRIFT.KING", "FOO-XL").

- [ ] **Step 5: Implement worldgen.ts composition + verify test PASS**

```ts
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { SpatialHash } from './collision';
import { makeHeightfield } from './terrain';
import { buildCity, type RoadSegment } from './city';
import { buildProps, type RampDef } from './props';
import { buildSky } from './sky';

export interface WorldData {
  seed: number;
  root: THREE.Group;
  hash: SpatialHash;
  height: ReturnType<typeof makeHeightfield>;
  roads: RoadSegment[];
  ramps: RampDef[];
  rings: THREE.Object3D[];
  spawn: THREE.Vector3;
  cityRadius: number;
  bounds: number;
  sky: ReturnType<typeof buildSky>;
}

export function generateWorld(seed: number): WorldData {
  const rng = new Rng(seed);
  const root = new THREE.Group();
  const hash = new SpatialHash(32);
  const height = makeHeightfield(8192, 256, seed ^ 0x9e3779b9, 40);
  const city = buildCity(rng, hash);
  const props = buildProps(rng, hash, city.roads);
  const sky = buildSky(root); // buildSky adds its own objects to the group/scene root
  root.add(city.root, props.root);
  return {
    seed, root, hash, height,
    roads: city.roads, ramps: props.ramps, rings: props.rings,
    spawn: city.spawn, cityRadius: city.cityRadius,
    bounds: 3800, sky,
  };
}
```

- [ ] **Step 6: Gates + commit**

```bash
git add -A && git commit -m "feat(world): procedural city, terrain, sky cycle, ramps and rings"
```

---

### Task 6: Vehicle — arcade physics + procedural car mesh

**Files:**
- Create: `src/vehicles/physics.ts`, `src/vehicles/carMesh.ts`, `tests/physics.test.ts`

**Interfaces:**
- Consumes: `InputFrame` (Task 3), `sampleGround` (Task 4).
- Produces:
  - `interface CarSpec { id: string; name: string; price: number; mass: number; power: number; grip: number; driftGrip: number; topSpeed: number; accel: number; handling: number; wing: boolean; colors: number[]; style: 'sport' | 'muscle' | 'super'; }` — `CARS: CarSpec[]` exported (3 cars: "Vortex GT" sport $0 starter, "Bruiser 440" muscle $12_000, "Nova X1" super $45_000).
  - `class CarPhysics { state: CarState; constructor(spec: CarSpec); tick(dt: number, input: InputFrame, world: WorldData): void; reset(pos: THREE.Vector3, yaw: number): void; position: THREE.Vector3; yaw: number; speed: number; grounded: boolean; }`
  - `interface CarState { pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; yawVel: number; pitch: number; roll: number; airborne: boolean; boostFuel: number; }`
  - `function buildCarMesh(spec: CarSpec): THREE.Group` — procedural chassis (bevelled box body + cabin + spoiler if wing + 4 cylinder wheels stored as `group.userData.wheels` + emissive headlights/taillights), per-spec silhouette params from `style`.

- [ ] **Step 1: Write failing physics tests**

`tests/physics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarPhysics, CARS } from '../src/vehicles/physics';
import type { InputFrame } from '../src/core/input';

const flatWorld = () => ({
  hash: { queryAABB: () => [], boxOf: () => undefined },
  height: { heightAt: () => 0, normalAt: () => new THREE.Vector3(0, 1, 0) },
  roads: [], ramps: [], bounds: 3800,
}) as never;

const idle: InputFrame = {
  throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false,
  toggleModePressed: false, pitch: 0, roll: 0, yaw: 0,
  cameraPressed: false, pausePressed: false, resetPressed: false,
};

describe('CarPhysics', () => {
  it('accelerates forward and clamps to top speed', () => {
    const car = new CarPhysics(CARS[0]!);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    const input = { ...idle, throttle: 1 };
    for (let i = 0; i < 60 * 30; i++) car.tick(1 / 60, input, flatWorld());
    expect(car.speed).toBeGreaterThan(20);
    expect(car.speed).toBeLessThanOrEqual(CARS[0]!.topSpeed + 0.5);
  });
  it('steering changes yaw when moving', () => {
    const car = new CarPhysics(CARS[0]!);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    const y0 = car.yaw;
    car.tick(1 / 60, { ...idle, throttle: 1, steer: 1 }, flatWorld());
    expect(Math.abs(car.yaw - y0)).toBeGreaterThan(0.001);
  });
  it('handbrake reduces grip (drift) — lateral speed grows', () => {
    const car = new CarPhysics(CARS[0]!);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 120; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    const straight = new THREE.Vector3().copy(car.state.vel);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 60; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    for (let i = 0; i < 30; i++) car.tick(1 / 60, { ...idle, throttle: 1, steer: 1, handbrake: true }, flatWorld());
    const lateral = Math.hypot(car.state.vel.x, car.state.vel.z) - car.forwardSpeed();
    expect(lateral).toBeGreaterThan(Math.abs(straight.length() - car.forwardSpeed()) + 0.5);
  });
});
```

- [ ] **Step 2: Verify FAIL**

- [ ] **Step 3: Implement physics.ts**

Model notes for implementer (arcade, not simulation):
- Forward dir `f = (sin yaw, 0, cos yaw)`; decompose `vel` into forward/lateral.
- Engine: `fForce = throttle * accel * (1 − forwardSpeed / topSpeed)` (+ boost ×1.6 while `boostFuel > 0`, drain 0.35/s, regen 0.1/s).
- Grip: lateral velocity decays toward 0 with `grip` (normal) or `driftGrip` (handbrake) exponent: `lat *= exp(−grip * dt)`.
- Steering: `yawVel = steer * handling * clamp(speed / 12, 0, 1) * (handbrake ? 1.5 : 1)`; `yaw += yawVel * dt`. Flip steer sign when reversing.
- Drag + rolling resistance; brake force opposing forward motion; reverse capped at 12 m/s.
- Ground: `y = sampleGround(...).height + wheelRadius`; airborne when falling; gravity −28 m/s² while airborne, landing kills vertical velocity; ramps launch by comparing heightAt ahead vs current.
- Bounds: soft wall beyond `world.bounds` — push velocity inward.
- Collision: query hash around pos; on `bld:`/`prop:` OBB overlap push out along smallest penetration axis and reflect velocity component (×0.3), emit impact impulse.

- [ ] **Step 4: Implement carMesh.ts** — per-style params (sport: low wide cabin, muscle: long hood, super: low wedge + big wing), MeshStandardMaterial with `metalness 0.6, roughness 0.35`, `userData.wheels: THREE.Mesh[]`, headlights as emissive boxes + two `SpotLight`s (only player car gets real lights).

- [ ] **Step 5: Run tests PASS, gates, commit**

```bash
git add -A && git commit -m "feat(vehicles): arcade car physics with drift and procedural car meshes"
```

---

### Task 7: Flight mode — jet + hover transitions

**Files:**
- Create: `src/vehicles/flight.ts`, `tests/flight.test.ts`
- Modify: `src/vehicles/physics.ts` (add `mode: 'drive' | 'fly' | 'hover'` to state, `transform()` method)

**Interfaces:**
- Consumes: `CarPhysics` (Task 6), `InputFrame`.
- Produces:
  - `class FlightModel { static enterDrive(p: CarPhysics): void; static enterFly(p: CarPhysics): void; static enterHover(p: CarPhysics): void; static tickFly(p: CarPhysics, dt: number, input: InputFrame, world: WorldData): void; }`
  - G key cycles drive → fly → hover → drive. Fly: pitch/roll/yaw full 3D, thrust along forward, lift + 1g compensation when throttle > 0.3, stall wobble below 18 m/s, ceiling 600 m. Hover: gravity replaced by spring to target altitude (W/S = climb/descend ±8 m/s, A/D yaw), max 35 m/s horizontal, drift dampening high — aerial parking.
  - Transformation animates over 0.8 s (wings deploy scale 0→1, thrusters glow) — handled in controller (Task 8), physics just lerp-toggles `airborne` handling and keeps momentum through the switch (momentum conservation is what makes the jet flip feel great).

- [ ] **Step 1: Write failing tests**

`tests/flight.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarPhysics, CARS } from '../src/vehicles/physics';
import { FlightModel } from '../src/vehicles/flight';
import type { InputFrame } from '../src/core/input';

const flatWorld = (() => ({
  hash: { queryAABB: () => [], boxOf: () => undefined },
  height: { heightAt: () => 0, normalAt: () => new THREE.Vector3(0, 1, 0) },
  roads: [], ramps: [], bounds: 3800,
}) as never);

const idle: InputFrame = {
  throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false,
  toggleModePressed: false, pitch: 0, roll: 0, yaw: 0,
  cameraPressed: false, pausePressed: false, resetPressed: false,
};

describe('FlightModel', () => {
  it('fly mode gains altitude under throttle and keeps momentum', () => {
    const car = new CarPhysics(CARS[0]!);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    for (let i = 0; i < 90; i++) car.tick(1 / 60, { ...idle, throttle: 1 }, flatWorld());
    const v0 = car.state.vel.length();
    FlightModel.enterFly(car);
    for (let i = 0; i < 60; i++) FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 1, pitch: 1 }, flatWorld());
    expect(car.position.y).toBeGreaterThan(3);
    expect(car.state.vel.length()).toBeGreaterThan(v0 * 0.5);
  });
  it('hover mode holds altitude and caps speed', () => {
    const car = new CarPhysics(CARS[0]!);
    car.reset(new THREE.Vector3(0, 0, 0), 0);
    FlightModel.enterHover(car);
    for (let i = 0; i < 120; i++) FlightModel.tickFly(car, 1 / 60, { ...idle }, flatWorld());
    expect(Math.abs(car.position.y)).toBeLessThan(4);
    for (let i = 0; i < 240; i++) FlightModel.tickFly(car, 1 / 60, { ...idle, throttle: 1, steer: 1 }, flatWorld());
    expect(Math.hypot(car.state.vel.x, car.state.vel.z)).toBeLessThan(36);
  });
});
```

- [ ] **Step 2: Verify FAIL → Step 3: Implement per model notes → Step 4: PASS**

Physics.ts additions required first: expose `pitch`, `roll` in `CarState`; add `transformTimer: number` and `mode` field; `tick()` delegates to `FlightModel.tickFly` when `mode !== 'drive'` (import cycle avoided by dependency inversion: `physics.ts` defines a `FlightTick` interface, `flight.ts` implements it, `controller.ts` (Task 8) wires it — simplest: `CarPhysics.tick` accepts an optional `flightTick?: FlightTick` parameter).

- [ ] **Step 5: Gates + commit**

```bash
git add -A && git commit -m "feat(vehicles): jet and hover flight modes with momentum-conserving transforms"
```

---

### Task 8: Controller, chase camera, mode-switch cinematics, engine audio

**Files:**
- Create: `src/vehicles/controller.ts`, `src/core/audio.ts`, `tests/controller.test.ts`

**Interfaces:**
- Consumes: `Engine` (2), `Input` (3), `WorldData` (5), `CarPhysics` (6), `FlightModel` (7).
- Produces:
  - `class VehicleController { constructor(engine: Engine, input: Input, world: WorldData, spec: CarSpec); mesh: THREE.Group; car: CarPhysics; update(dt: number): void; setCameraMode(m: 'chase' | 'hood' | 'orbit'): void; dispose(): void; }` — owns car + mesh + camera rig + mode toggling on `toggleModePressed` + wheel spin/steer visuals + drift smoke particles (simple `Points` pool, 300 particles) + tire skid decal skip (YAGNI).
  - `class AudioEngine { constructor(); resume(): void; setEngine(rpm01: number, load: number): void; setWind(speed01: number): void; blip(kind: 'ui' | 'complete' | 'fail' | 'transform'): void; dispose(): void; }` — pure WebAudio synthesis: 2 detuned saw oscillators + lowpass for engine (freq 60–320 Hz mapped from rpm), filtered noise buffer for wind, ADSR envelopes for blips. Started only after first user gesture (`resume()` on click/keydown).

- [ ] **Step 1: Write failing controller test** (headless-friendly: verify mode toggle and camera reposition math by calling `update` with a stubbed Input)

```ts
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../src/vehicles/controller';

describe('CameraRig', () => {
  it('chase camera sits behind and above the car and lerps smoothly', () => {
    const rig = new CameraRig();
    const pos = new (rig as never as { computeChase: (p: { yaw: number }, dist: number) => { x: number; z: number } })
      .computeChase({ yaw: 0 }, 8);
    expect(pos.z).toBeCloseTo(-8, 5); // behind car facing +z at yaw 0
  });
});
```

- [ ] **Step 2: FAIL → Step 3: implement** — `CameraRig` exported separately for testability: `computeChase(car, dist)` returns offset vector; rig lerps position (k = 1 − exp(−8dt)) and lookAt car + velocity lead. Hood cam parented; orbit = slow auto-rotate.
- [ ] **Step 4: PASS + gates + commit**

```bash
git add -A && git commit -m "feat(vehicles): controller, camera rig, drift smoke, synth engine audio"
```

---

### Task 9: Game state, economy, collectibles

**Files:**
- Create: `src/game/state.ts`, `src/game/economy.ts`, `src/game/collectibles.ts`, `src/core/save.ts`, `tests/economy.test.ts`, `tests/save.test.ts`

**Interfaces:**
- Consumes: `Rng`, `WorldData`, `CARS`.
- Produces:
  - `interface SaveSchemaV1 { version: 1; money: number; ownedCars: string[]; currentCar: string; completedMissions: string[]; upgrades: Record<string, number>; settings: { music: boolean; sfx: boolean; quality: 'low' | 'med' | 'high' }; totalEarned: number; playtimeS: number; }`
  - `class GameStore { readonly s: SaveSchemaV1; subscribe(fn: () => void): void; earn(n: number): void; spend(n: number): boolean; buyCar(id: string): boolean; equip(id: string): void; completeMission(id: string, reward: number): void; save(): void; static load(): GameStore | null; }` — `save()` persists to localStorage key `skyforge.save.v1`, debounced 2 s.
  - `export const UPGRADES = { engine: { name: 'Engine', max: 5, baseCost: 1500 }, ... }` — `cost(u: keyof typeof UPGRADES, level: number): number` = `baseCost * 1.8^level`; each engine level +8% topSpeed/accel, grip +6%, boost tank +15%.
  - `class Collectibles { constructor(world: WorldData, rng: Rng, onPickup: (kind: 'cash' | 'boost' | 'ring', value: number) => void); update(car: CarPhysics, dt: number): void; reset(): void; }` — cash pickups ($50–250) respawn 60 s; boost tokens refill fuel; rings award $25 on fly-through (checked in fly/hover modes), all with idle spin animation and pickup scale-pop.

- [ ] **Step 1: Write failing tests** — economy: cost curve monotonic, spend refuses when broke, buyCar removes money and adds ownership exactly once; save: roundtrip `SaveSchemaV1` through a mocked `localStorage` (inject storage interface `SaveStorage { get(k): string | null; set(k, v): void }` for testability).

- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS + gates + commit**

```bash
git add -A && git commit -m "feat(game): economy, upgrades, collectibles, versioned save system"
```

---

### Task 10: Traffic AI + missions

**Files:**
- Create: `src/game/traffic.ts`, `src/game/missions.ts`, `tests/missions.test.ts`

**Interfaces:**
- Consumes: `WorldData.roads`, `CarPhysics`, `GameStore`.
- Produces:
  - `class Traffic { constructor(world: WorldData, count: number); cars: { mesh: THREE.Group; pos: THREE.Vector3; yaw: number; speed: number }[]; update(dt: number, player: CarPhysics): void; dispose(): void; }` — 14 AI cars follow lane-offset paths along `roads`, turn at intersections (rng chosen, recorded for determinism), simple slow-down when player or car ahead within 12 m cone; collisions with player emit bump impulse only (no damage model).
  - `interface MissionDef { id: string; kind: 'race' | 'delivery' | 'stunt'; title: string; reward: number; par: number; }` — `class Missions { constructor(world: WorldData, store: GameStore, rng: Rng); active: MissionDef | null; start(kind: MissionDef['kind']): MissionDef; update(car: CarPhysics, dt: number): 'running' | 'won' | 'lost' | 'idle'; abandon(): void; }`
    - **Race:** 8–12 checkpoints (glowing gates) generated on roads within city; beat `par` seconds. Timer HUD handled in Task 11 via events `'mission:tick'`.
    - **Delivery:** pick up package marker, deliver to target across town within time; cargo sways car handling (grip ×0.85) — that's the fun.
    - **Stunt:** "score 3000 pts in 60 s" — airtime ×200, near-miss traffic ×150, ring ×50, drift ×20/s; combo multiplier decays after 3 s idle.
  - Events emitted on `Emitter`: `'mission:complete' { id, reward }`, `'mission:fail' { id }`, `'mission:checkpoint' { n, total }`.

- [ ] **Step 1: Write failing tests** — race: simulate car driving through checkpoint positions with teleported `car.position` per tick, expect 'won' under par; delivery pickup→deliver ordering enforced; stunt score math unit-tested with synthetic input.

- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS + gates + commit**

```bash
git add -A && git commit -m "feat(game): traffic AI and race/delivery/stunt missions"
```

---

### Task 11: HUD, menus, toasts, garage UI, settings

**Files:**
- Create: `src/ui/hud.ts`, `src/ui/menus.ts`, `src/ui/toast.ts`, `tests/hud.test.ts`

**Interfaces:**
- Consumes: everything.
- Produces:
  - `class Hud { constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D); render(frame: HudFrame): void; }` with `interface HudFrame { speedKmh: number; mode: 'drive' | 'fly' | 'hover'; boostFuel: number; money: number; minimap: { playerX: number; playerZ: number; playerYaw: number; blips: { x: number; z: number; kind: 'mission' | 'traffic' | 'ring' | 'garage' }[] }; mission: { title: string; timer: number; score: number } | null; fps: number; }`
  - Design language (the "heavy design" requirement): HUD is a single full-screen 2D canvas layered over WebGL. Neon-dark synthwave palette (bg `#0a0e1a`, primary cyan `#22d3ee`, accent magenta `#e879f9`, warn amber `#fbbf24`); speedo = 220 px arc gauge bottom-right with rpm ring, digital kmh, mode glyph; minimap top-left 180 px circular, rotated to player yaw, roads pre-rendered once to an offscreen canvas; mission tracker top-center with animated timer bar; money counter top-right with count-up tween; damage-free design, all text `Inter` fallback `system-ui`; UI sound blips on hover/press via `AudioEngine.blip`.
  - `class Menus { constructor(root: HTMLElement, store: GameStore, audio: AudioEngine, hooks: { onStart(): void; onEquip(id: string): void; onBuy(id: string): void; onUpgrade(u: string): void; onQuality(q: 'low' | 'med' | 'high'): void; onResume(): void; }); showTitle(): void; showGarage(): void; showPause(): void; hideAll(): void; visible: 'title' | 'garage' | 'pause' | 'settings' | null; }` — DOM overlays with glassmorphism panels, animated on open (CSS transform + opacity transitions), car cards render a canvas-rendered spec sheet (top speed bar, accel bar, handling bar, price, OWNED/EQUIPPED badges), settings toggles music/sfx/quality + reset save (with confirm).
  - `toast(msg: string, kind: 'info' | 'good' | 'bad'): void` — stacked bottom-center, slide-up + fade, 2.5 s.

- [ ] **Step 1: Write failing test** — `Hud.render` with a stub 2D context records `fillText`/`arc` calls; assert speed number rendered, mission timer rendered, no throw with empty blips. Test minimap offscreen pre-render with a fake `roads` array.

- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS + gates + commit**

```bash
git add -A && git commit -m "feat(ui): synthwave HUD, garage/menus, toasts"
```

---

### Task 12: Assembly — main.ts game loop wiring

**Files:**
- Modify: `src/main.ts` (full rewrite), `index.html` (add UI root div + font link)

**Interfaces:**
- Consumes: all modules.
- Produces: the playable game. Boot sequence: title menu (menus.ts) → on Start: `generateWorld(seed from save or Date.now())`, `VehicleController` with `store.s.currentCar` spec, `AudioEngine.resume()`, HUD on. Frame pipeline (fixed 1/120 tick): `input.poll()` → `missions.update` → `controller.update` → `traffic.update` → `collectibles.update` → `world.sky.update(t)` → store autosave; render pass: 3D canvas then HUD canvas. Pause: stop physics ticks, keep render, show menus.

- [ ] **Step 1: Manual smoke checklist (dev server):** title → start → drive, G toggles fly (wings animate, altitude works), hover parks mid-air, handbrake drifts, ramp jump lands, mission start via marker → race gate sequence completes → money credited → garage buy/equip works → save survives reload.
- [ ] **Step 2: Perf check:** `engine.stats.fps ≥ 55` standing in city, ≥ 45 flying over terrain at 600 m (Chrome, hardware GPU). If low: reduce shadow map size, cull rings, lower pixel ratio.
- [ ] **Step 3: Fix findings, gates, commit**

```bash
git add -A && git commit -m "feat: assemble playable game loop"
```

---

### Task 13: Polish pass — juice, quality settings, mobile input

**Files:**
- Modify: `src/vehicles/controller.ts` (screen shake on landing, boost FOV kick), `src/ui/hud.ts` (speed lines while boosting), `src/core/input.ts` (touch: left virtual stick steer, right side throttle/brake buttons, tap G-equivalent to transform), `index.html` (add touch UI divs)

**Interfaces:** unchanged from earlier tasks — this task only deepens existing behavior.

- [ ] **Step 1: Implement juice items** (each small, verifiable visually).
- [ ] **Step 2: Touch controls self-test** in Chrome device toolbar (iPhone + Pixel presets): steer/brake/transform all reachable, no double-tap zoom (add `touch-action: none`).
- [ ] **Step 3: Quality presets:** low = pixelRatio 1, no shadows, fog closer; med = pixelRatio 1.5, 1024 shadows; high = pixelRatio 2, 2048 shadows, +12% draw distance. Auto-detect default from `navigator.hardwareConcurrency`.
- [ ] **Step 4: Gates + commit**

```bash
git add -A && git commit -m "feat: polish pass — juice, quality presets, touch controls"
```

---

### Task 14: Production deploy — Vercel + custom .xyz domain

**Files:**
- Create: `vercel.json`, `.github/workflows/deploy.yml`
- Modify: `index.html` (SEO meta: title, description, og:image generated later)

**Interfaces:**
- Produces: live URL + custom domain.

- [ ] **Step 1: Production build check locally**

```bash
pnpm build && pnpm preview
```

Expected: game playable at localhost:4173.

- [ ] **Step 2: Deploy config**

`vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

- [ ] **Step 3: Connect hosting (user-assisted)**
  - User opens the Vercel setup link (tracked URL provided in chat) and either (a) authorizes the agent with a `VERCEL_TOKEN` pasted back, or (b) connects the GitHub repo manually via dashboard.
  - Import `skyforge-racer` → framework auto-detects Vite → deploy.
  - Domains → add the user's `.xyz` domain → follow DNS instructions at the registrar (A 76.76.21.21 / CNAME cname.vercel-dns.com).
- [ ] **Step 4: Verify production:** HTTPS works on the custom domain, first-load < 3 s on Fast 3G throttle, no console errors, save persists across reload on the domain.
- [ ] **Step 5: Commit + push**

```bash
git add -A && git commit -m "chore: production deploy config" && git push origin main
```

---

## Self-review notes

- **Spec coverage:** open world (T5), race car + normal car (T6 CARS, garage T11), fly mode (T7), full game loop — races/delivery/stunts (T10), traffic (T10), economy/upgrades (T9), garage (T11), heavy design (T11 HUD/menus design language, T13 juice), production + .xyz domain (T14), GitHub repo (T1 Step 7).
- **Placeholders:** none — every task lists concrete files, interfaces, test code, and model notes; "notes for implementer" sections give the algorithm, the implementer writes the exact code against the tests.
- **Type consistency:** `InputFrame` (T3) consumed by physics (T6) and flight (T7) with identical fields; `WorldData` (T5) matches flatWorld stubs in T6/T7 tests; `CarPhysics`/`CARS` exported from `physics.ts` and imported by flight (T7) and controller (T8); `SaveSchemaV1` (T9) is what menus (T11) read/write.
- **Known simplifications (deliberate, documented):** 2D SAT collisions (top-down boxes, y resolved separately), no multiplayer, no backend — everything in scope for a static-site game.
