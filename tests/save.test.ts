import { describe, expect, it } from 'vitest';
import {
  defaultSave,
  deserializeSave,
  fromSaveCode,
  saveCode,
  serializeSave,
  SAVE_KEY,
  writeSave,
  loadSave,
  clearSave,
  type SaveSchemaV1,
  type SaveStorage,
} from '../src/core/save';

function memoryStorage(): SaveStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
  };
}

describe('save system', () => {
  it('roundtrips through serialize/deserialize', () => {
    const save = defaultSave();
    save.money = 4321;
    save.ownedCars = ['vortex-gt', 'nova-x1'];
    save.upgrades = { engine: 3 };
    const back = deserializeSave(serializeSave(save));
    expect(back).not.toBeNull();
    expect(back?.money).toBe(4321);
    expect(back?.ownedCars).toEqual(['vortex-gt', 'nova-x1']);
    expect(back?.upgrades).toEqual({ engine: 3 });
  });

  it('rejects unknown versions and corrupt JSON', () => {
    expect(deserializeSave('{"version":2}')).toBeNull();
    expect(deserializeSave('not json at all {')).toBeNull();
  });

  it('fills defaults for missing fields', () => {
    const back = deserializeSave('{"version":1,"money":99}');
    expect(back?.money).toBe(99);
    expect(back?.ownedCars).toEqual(defaultSave().ownedCars);
    expect(back?.settings.quality).toBe('high');
  });

  it('persists through storage and clears', () => {
    const st = memoryStorage();
    const save = defaultSave();
    save.money = 777;
    writeSave(save, st);
    expect(st.map.get(SAVE_KEY)).toBeTruthy();
    const loaded = loadSave(st);
    expect(loaded?.money).toBe(777);
    clearSave(st);
    expect(deserializeSave(st.map.get(SAVE_KEY) ?? '')).toBeNull();
  });

  it('save codes roundtrip', () => {
    const save = defaultSave();
    save.money = 12345;
    const code = saveCode(save);
    expect(code).not.toContain('{');
    const back = fromSaveCode(code);
    expect(back?.money).toBe(12345);
    expect(fromSaveCode('!!!garbage!!!')).toBeNull();
  });
});

// Re-import for store tests.
import { GameStore } from '../src/game/state';
import { upgradeCost, UPGRADES, effectiveStats } from '../src/game/economy';
import { CARS } from '../src/vehicles/physics';

describe('GameStore', () => {
  it('earn/spend manage money atomically', () => {
    const store = new GameStore(memoryStorage(), defaultSave());
    store.earn(1000);
    expect(store.money).toBe(1500);
    expect(store.spend(500)).toBe(true);
    expect(store.money).toBe(1000);
    expect(store.spend(9999)).toBe(false);
    expect(store.money).toBe(1000);
  });

  it('buyCar charges once and refuses duplicates', () => {
    const store = new GameStore(memoryStorage(), defaultSave());
    const nova = CARS[2] as NonNullable<(typeof CARS)[number]>;
    store.earn(nova.price); // fund the purchase
    expect(store.buyCar(nova.id, nova.price)).toBe(true);
    expect(store.money).toBe(500);
    expect(store.s.ownedCars).toContain(nova.id);
    expect(store.buyCar(nova.id, nova.price)).toBe(false);
    expect(store.money).toBe(500 - nova.price);
    store.equipCar(nova.id);
    expect(store.s.currentCar).toBe(nova.id);
    store.equipCar('not-owned');
    expect(store.s.currentCar).toBe(nova.id);
  });

  it('completeMission pays once', () => {
    const store = new GameStore(memoryStorage(), defaultSave());
    expect(store.completeMission('race-1', 750)).toBe(true);
    expect(store.money).toBe(1250);
    expect(store.completeMission('race-1', 750)).toBe(false);
    expect(store.money).toBe(1250);
  });

  it('notifies subscribers on change', () => {
    const store = new GameStore(memoryStorage(), defaultSave());
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.earn(10);
    store.earn(10);
    off();
    store.earn(10);
    expect(calls).toBe(2);
  });
});

describe('economy', () => {
  it('upgrade costs grow geometrically', () => {
    const engine = UPGRADES[0] as NonNullable<(typeof UPGRADES)[number]>;
    const c0 = upgradeCost(engine, 0);
    const c1 = upgradeCost(engine, 1);
    const c2 = upgradeCost(engine, 2);
    expect(c0).toBe(engine.baseCost);
    expect(c1).toBe(Math.round(engine.baseCost * 1.8));
    expect(c2).toBeGreaterThan(c1);
  });

  it('effectiveStats apply multipliers', () => {
    const spec = CARS[0] as NonNullable<(typeof CARS)[number]>;
    const stats = effectiveStats(spec, { engine: 2, grip: 1 });
    expect(stats.topSpeed).toBeCloseTo(spec.topSpeed * 1.16, 3);
    expect(stats.grip).toBeCloseTo(spec.grip * 1.06, 3);
    expect(stats.boost).toBe(1);
  });
});

// Silence unused type import lint in some configs.
export type { SaveSchemaV1 };
