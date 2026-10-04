import * as THREE from 'three';
import { Engine } from './core/engine';
import { Input } from './core/input';
import { AudioEngine } from './core/audio';
import { loadSave, type SaveStorage } from './core/save';
import { Rng } from './core/rng';
import { generateWorld, type WorldData } from './world/worldgen';
import { sampleGround } from './world/collision';
import { CARS, type CarSpec } from './vehicles/physics';
import { VehicleController } from './vehicles/controller';
import { UPGRADES, effectiveStats, type CarStats } from './game/economy';
import { GameStore } from './game/state';
import { Missions, type MissionDef } from './game/missions';
import { Traffic } from './game/traffic';
import { Collectibles } from './game/collectibles';
import { Hud, computeBlips, type HudFrame } from './ui/hud';
import { Menus } from './ui/menus';
import { Toaster } from './ui/toast';

export interface GameLoop {
  dispose(): void;
}

/** Spec with garage upgrades baked in (physics consumes the raw numbers). */
function specOf(store: GameStore): CarSpec {
  const base = CARS.find((c) => c.id === store.s.currentCar) ?? CARS[0]!;
  const st = effectiveStats(base, store.s.upgrades);
  return { ...base, topSpeed: st.topSpeed, accel: st.accel, grip: st.grip, handling: st.handling };
}

function disposeTree(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

export function startGame(canvas: HTMLCanvasElement): GameLoop {
  const engine = new Engine(canvas);
  const input = new Input();
  const audio = new AudioEngine();

  const storage: SaveStorage = {
    get: (k) => window.localStorage.getItem(k),
    set: (k, v) => window.localStorage.setItem(k, v),
  };
  const hadSave = loadSave(storage) !== null;
  const store = new GameStore(storage);
  // First run: pick a quality preset the device can handle.
  if (!hadSave && (navigator.hardwareConcurrency ?? 8) <= 4) {
    store.setQuality('low');
  }

  const uiRoot = (document.getElementById('ui') ?? document.body) as HTMLElement;
  const hudCanvas = document.getElementById('hud') as HTMLCanvasElement | null;
  const hudCtx = hudCanvas?.getContext('2d') ?? null;

  const sizeHud = (): void => {
    if (!hudCanvas) return;
    hudCanvas.width = window.innerWidth;
    hudCanvas.height = window.innerHeight;
  };
  sizeHud();
  window.addEventListener('resize', sizeHud);

  // ---------------------------------------------------------------- state
  let started = false; // title vs in-game
  let paused = false;
  let world: WorldData | null = null;
  let controller: VehicleController | null = null;
  let missions: Missions | null = null;
  let traffic: Traffic | null = null;
  let collectibles: Collectibles | null = null;
  let hud: Hud | null = null;
  let effStats: CarStats = effectiveStats(CARS[0]!, {});
  let lastSpecSig = '';
  let uiAcc = 0;
  let playtimeAcc = 0;
  // Dummy player far away so traffic ignores braking during the title fly-by.
  const farAway = { state: { pos: new THREE.Vector3(99999, 0, 99999), vel: new THREE.Vector3() } };

  function specSig(): string {
    return `${store.s.currentCar}|${store.s.settings.colorIndex}|${JSON.stringify(store.s.upgrades)}`;
  }

  // ---------------------------------------------------------------- world
  function teardownWorld(): void {
    controller?.dispose();
    controller = null;
    if (traffic && world) traffic.dispose(world);
    traffic = null;
    if (collectibles && world) collectibles.dispose(world);
    collectibles = null;
    missions = null;
    hud = null;
    if (world) {
      engine.world.remove(world.root);
      disposeTree(world.root);
      world = null;
    }
  }

  function onModeChange(mode: 'drive' | 'fly' | 'hover'): void {
    audio.blip('transform');
    toaster.show(mode === 'fly' ? '✈  JET MODE' : mode === 'hover' ? '◎  HOVER MODE' : 'CAR MODE', 'info');
  }

  function spawnPlayer(): void {
    if (!world) return;
    controller?.dispose();
    const spec = specOf(store);
    effStats = effectiveStats(CARS.find((c) => c.id === spec.id) ?? CARS[0]!, store.s.upgrades);
    controller = new VehicleController(engine.world, input, world, spec, engine.camera, store.s.settings.colorIndex);
    controller.car.boostCapacity = effStats.boost;
    controller.onModeChange = onModeChange;
    lastSpecSig = specSig();
  }

  /** Rebuild the car (equip/repaint/upgrade) keeping position + heading. */
  function rebuildPlayer(preserve: boolean): void {
    if (!world) return;
    const prev = controller;
    const pos = preserve && prev ? prev.car.position.clone() : null;
    const yaw = preserve && prev ? prev.car.yaw : 0;
    spawnPlayer();
    if (pos && controller) {
      controller.car.reset(pos, yaw);
      const g = sampleGround(pos.x, pos.z, world.height, world.hash);
      controller.car.state.pos.y = g.height + 0.35;
      controller.rig.snapBehind(controller.car);
    }
  }

  /** Quality preset: pixel ratio, shadow maps, draw distance. */
  function applyQuality(q: 'low' | 'med' | 'high'): void {
    const r = engine.renderer;
    r.setPixelRatio(
      q === 'low' ? 1 : q === 'med' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2),
    );
    const shadows = q !== 'low';
    if (r.shadowMap.enabled !== shadows) {
      r.shadowMap.enabled = shadows;
      engine.world.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => (m.needsUpdate = true));
        else if (mat) mat.needsUpdate = true;
      });
    }
    if (world) {
      const size = q === 'high' ? 2048 : 1024;
      world.sky.sun.shadow.mapSize.set(size, size);
      if (world.sky.sun.shadow.map) {
        world.sky.sun.shadow.map.dispose();
        world.sky.sun.shadow.map = null;
      }
      const fog = engine.world.fog as THREE.Fog | null;
      if (fog) fog.far = q === 'low' ? 1500 : q === 'med' ? 2200 : 2800;
    }
  }

  function buildWorld(seed: number): void {
    teardownWorld();
    world = generateWorld(seed, engine.world);
    engine.world.add(world.root);

    traffic = new Traffic(world, new Rng(seed ^ 0x1234abcd));
    collectibles = new Collectibles(world, new Rng(seed ^ 0x7f4a7c15), {
      onCash: (amount) => {
        store.earn(amount);
        toaster.show(`+$${amount}`, 'good');
      },
      onBoost: (fraction) => {
        if (controller) {
          controller.car.state.boostFuel = Math.min(1, controller.car.state.boostFuel + fraction);
        }
      },
      onRing: (amount) => {
        store.earn(amount);
        missions?.award('ring');
        toaster.show(`Ring +$${amount}`, 'info');
      },
    });
    missions = new Missions(world, new Rng(seed ^ 0x2545f491), {
      onCheckpoint: (n, total) => {
        audio.blip('checkpoint');
        toaster.show(`Checkpoint ${n}/${total}`, 'info');
      },
      onWon: (def: MissionDef) => {
        const first = store.completeMission(def.id, def.reward);
        if (!first) store.earn(Math.round(def.reward * 0.4));
        audio.blip('good');
        toaster.show(
          first
            ? `${def.title} complete! +$${def.reward}`
            : `${def.title} complete! +$${Math.round(def.reward * 0.4)} (repeat)`,
          'good',
        );
      },
      onLost: () => {
        audio.blip('bad');
        toaster.show('Mission failed — press 1/2/3 to retry', 'bad');
      },
      onEvent: () => {
        /* stunt scoring streams live into the HUD tracker */
      },
    });
    traffic.onBump = () => missions?.award('nearmiss');
    hud = hudCtx ? new Hud(hudCtx, world.roads) : null;
    applyQuality(store.s.settings.quality);
  }

  // ---------------------------------------------------------------- menu hooks
  function onStart(): void {
    audio.resume();
    if (!world) buildWorld(store.s.seed);
    if (!controller) spawnPlayer();
    started = true;
    paused = false;
    menus.hideAll();
  }
  function onEquip(spec: CarSpec): void {
    store.equipCar(spec.id); // store subscription rebuilds the car in place
  }
  function onBuy(spec: CarSpec): void {
    toaster.show(`${spec.name} added to your garage!`, 'good');
  }
  function onUpgrade(upgradeId: string): void {
    const def = UPGRADES.find((u) => u.id === upgradeId);
    toaster.show(`${def?.name ?? 'Upgrade'} installed!`, 'good');
  }
  function onQuality(q: 'low' | 'med' | 'high'): void {
    applyQuality(q);
  }
  function onResume(): void {
    paused = false;
    menus.hideAll();
  }
  function onRespawn(): void {
    controller?.respawn();
    paused = false;
    menus.hideAll();
  }
  function onNewWorld(): void {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    store.setSeed(seed);
    buildWorld(seed);
    spawnPlayer();
    started = true;
    paused = false;
    menus.hideAll();
    toaster.show('New city generated!', 'info');
  }

  const menus = new Menus(uiRoot, store, audio, {
    onStart,
    onEquip,
    onBuy,
    onUpgrade,
    onQuality,
    onResume,
    onRespawn,
    onNewWorld,
  });
  const toaster = new Toaster(uiRoot);

  // On-screen touch buttons -> synthetic key state.
  const keyBtnDisposers: Array<() => void> = [];
  for (const el of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-vkey]'))) {
    const code = el.dataset['vkey'] ?? '';
    if (!code) continue;
    const down = (e: Event): void => {
      e.preventDefault();
      el.blur();
      audio.resume();
      input.virtualDown(code);
    };
    const up = (e: Event): void => {
      e.preventDefault();
      input.virtualUp(code);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
    keyBtnDisposers.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointerleave', up);
      el.removeEventListener('pointercancel', up);
    });
  }

  // ---------------------------------------------------------------- listeners
  const unsubStore = store.subscribe(() => {
    if (controller && specSig() !== lastSpecSig) rebuildPlayer(true);
  });

  const resumeAudio = (): void => {
    audio.resume();
    window.removeEventListener('pointerdown', resumeAudio);
    window.removeEventListener('keydown', resumeAudio);
  };
  window.addEventListener('pointerdown', resumeAudio);
  window.addEventListener('keydown', resumeAudio);

  const onMissionKey = (e: KeyboardEvent): void => {
    if (!started || paused || !missions || !controller) return;
    const kind = e.code === 'Digit1' ? 'race' : e.code === 'Digit2' ? 'delivery' : e.code === 'Digit3' ? 'stunt' : null;
    if (!kind) return;
    if (missions.active) missions.abandon();
    const def = missions.start(kind);
    if (def) {
      audio.blip('checkpoint');
      toaster.show(`${def.title} — GO!`, 'info');
    }
  };
  window.addEventListener('keydown', onMissionKey);

  // ---------------------------------------------------------------- HUD + audio
  function renderHud(): void {
    if (!hudCtx || !hud || !started || !controller) return;
    const car = controller.car;
    const hs = missions?.hudState();
    const active = missions?.active ?? null;
    const blips = computeBlips(
      car.position,
      missions?.gatePositions() ?? [],
      traffic?.cars.map((c) => c.mesh.position) ?? [],
      world?.rings.map((r) => r.position) ?? [],
      null,
    );
    const frame: HudFrame = {
      speedKmh: car.speed * 3.6,
      mode: car.state.mode,
      boostFuel: car.state.boostFuel,
      money: store.money,
      airborne: car.state.airborne,
      minimap: { playerX: car.position.x, playerZ: car.position.z, playerYaw: car.yaw, blips },
      mission:
        active && hs
          ? {
              title: hs.title,
              time: hs.time,
              par: active.par,
              score: hs.score,
              isStunt: active.kind === 'stunt',
              checkpoint: hs.checkpoint,
              total: hs.total,
            }
          : null,
      fps: engine.stats.fps,
    };
    hud.render(frame);
  }

  function updateAudio(): void {
    if (!started || !controller) {
      audio.setEngine(0, 0, false);
      audio.setWind(0);
      return;
    }
    const car = controller.car;
    const speed01 = Math.min(car.speed / Math.max(effStats.topSpeed, 1), 1);
    audio.setEngine(input.frame.throttle, speed01, !paused);
    audio.setWind(Math.min(1, speed01 + (car.state.mode !== 'drive' ? 0.25 : 0)));
  }

  // ---------------------------------------------------------------- main loop
  function tick(dt: number, t: number): void {
    input.poll();

    // Esc: pause/resume in game; back out of sub-screens on the title.
    if (input.frame.pausePressed) {
      if (started) {
        paused = !paused;
        if (paused) menus.showPause();
        else menus.hideAll();
        audio.blip('ui');
      } else if (menus.visible && menus.visible !== 'title') {
        menus.showTitle();
      }
    }

    if (world) world.sky.update(t);

    if (started && !paused && controller && missions && traffic && collectibles && world) {
      missions.update(controller.car, dt);
      controller.update(dt, false);
      traffic.update(dt, controller.car);
      collectibles.update(controller.car, dt);

      playtimeAcc += dt;
      if (playtimeAcc >= 5) {
        store.addPlaytime(playtimeAcc);
        playtimeAcc = 0;
      }
    } else if (started && controller && world) {
      controller.update(dt, true); // paused: keep camera + visuals alive
    } else if (world && traffic) {
      // Title cinematic: slow orbit over a living city.
      if (!started) traffic.update(dt, farAway);
      const a = t * 0.06;
      engine.camera.position.set(Math.cos(a) * 300, 110 + Math.sin(a * 0.7) * 30, Math.sin(a) * 300);
      engine.camera.lookAt(0, 24, 0);
    }

    // ~30 Hz UI + audio layer (physics ticks at 120 Hz).
    uiAcc += dt;
    if (uiAcc >= 1 / 30) {
      uiAcc = 0;
      renderHud();
      updateAudio();
    }
  }

  // ---------------------------------------------------------------- boot
  buildWorld(store.s.seed);
  menus.showTitle();
  engine.onFrame(tick);
  engine.start();

  return {
    dispose(): void {
      keyBtnDisposers.forEach((d) => d());
      unsubStore();
      window.removeEventListener('resize', sizeHud);
      window.removeEventListener('keydown', onMissionKey);
      window.removeEventListener('pointerdown', resumeAudio);
      teardownWorld();
      engine.dispose();
      input.dispose();
      audio.dispose();
      toaster.dispose();
      menus.dispose();
    },
  };
}

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (canvas) {
  startGame(canvas);
}
