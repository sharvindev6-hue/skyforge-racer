/**
 * Versioned save schema + localStorage persistence.
 * Injectable storage keeps this unit-testable in node.
 */
export interface SaveSchemaV1 {
  version: 1;
  money: number;
  ownedCars: string[];
  currentCar: string;
  completedMissions: string[];
  upgrades: Record<string, number>;
  settings: {
    music: boolean;
    sfx: boolean;
    quality: 'low' | 'med' | 'high';
    colorIndex: number;
  };
  totalEarned: number;
  playtimeS: number;
  seed: number;
}

export interface SaveStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const SAVE_KEY = 'skyforge.save.v1';

export function defaultSave(): SaveSchemaV1 {
  return {
    version: 1,
    money: 500,
    ownedCars: ['vortex-gt'],
    currentCar: 'vortex-gt',
    completedMissions: [],
    upgrades: {},
    settings: { music: true, sfx: true, quality: 'high', colorIndex: 0 },
    totalEarned: 0,
    playtimeS: 0,
    seed: 1337,
  };
}

export function serializeSave(save: SaveSchemaV1): string {
  return JSON.stringify(save);
}

export function deserializeSave(raw: string): SaveSchemaV1 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SaveSchemaV1> & { version?: number };
    if (parsed.version !== 1) return null;
    const base = defaultSave();
    return {
      version: 1,
      money: typeof parsed.money === 'number' ? parsed.money : base.money,
      ownedCars: Array.isArray(parsed.ownedCars) ? parsed.ownedCars : base.ownedCars,
      currentCar: typeof parsed.currentCar === 'string' ? parsed.currentCar : base.currentCar,
      completedMissions: Array.isArray(parsed.completedMissions) ? parsed.completedMissions : [],
      upgrades: parsed.upgrades && typeof parsed.upgrades === 'object' ? parsed.upgrades : {},
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      totalEarned: typeof parsed.totalEarned === 'number' ? parsed.totalEarned : 0,
      playtimeS: typeof parsed.playtimeS === 'number' ? parsed.playtimeS : 0,
      seed: typeof parsed.seed === 'number' ? parsed.seed : base.seed,
    };
  } catch {
    return null;
  }
}

export function loadSave(storage: SaveStorage): SaveSchemaV1 | null {
  const raw = storage.get(SAVE_KEY);
  return raw ? deserializeSave(raw) : null;
}

export function writeSave(save: SaveSchemaV1, storage: SaveStorage): void {
  storage.set(SAVE_KEY, serializeSave(save));
}

export function clearSave(storage: SaveStorage): void {
  storage.set(SAVE_KEY, '');
}

/** Compact save code for manual export/import (base64 of JSON). */
export function saveCode(save: SaveSchemaV1): string {
  return btoa(serializeSave(save));
}

export function fromSaveCode(code: string): SaveSchemaV1 | null {
  try {
    return deserializeSave(atob(code.trim()));
  } catch {
    return null;
  }
}
