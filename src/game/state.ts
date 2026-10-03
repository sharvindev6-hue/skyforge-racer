import { defaultSave, loadSave, writeSave, type SaveSchemaV1, type SaveStorage } from '../core/save';

/**
 * Central game state. Mutations go through methods so UI + persistence
 * stay consistent. Autosave is debounced.
 */
export class GameStore {
  readonly s: SaveSchemaV1;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private storage: SaveStorage;

  constructor(storage: SaveStorage, existing?: SaveSchemaV1 | null) {
    this.storage = storage;
    this.s = existing ?? loadSave(storage) ?? defaultSave();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.listeners.forEach((fn) => fn());
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  save(): void {
    writeSave(this.s, this.storage);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  get money(): number {
    return this.s.money;
  }

  earn(n: number): void {
    this.s.money += n;
    this.s.totalEarned += Math.max(0, n);
    this.changed();
  }

  spend(n: number): boolean {
    if (this.s.money < n) return false;
    this.s.money -= n;
    this.changed();
    return true;
  }

  ownsCar(id: string): boolean {
    return this.s.ownedCars.includes(id);
  }

  buyCar(id: string, price: number): boolean {
    if (this.ownsCar(id)) return false;
    if (!this.spend(price)) return false;
    this.s.ownedCars.push(id);
    this.changed();
    return true;
  }

  equipCar(id: string): void {
    if (!this.ownsCar(id)) return;
    this.s.currentCar = id;
    this.changed();
  }

  setColorIndex(i: number): void {
    this.s.settings.colorIndex = i;
    this.changed();
  }

  completeMission(id: string, reward: number): boolean {
    if (this.s.completedMissions.includes(id)) return false;
    this.s.completedMissions.push(id);
    this.earn(reward);
    return true;
  }

  missionCompleted(id: string): boolean {
    return this.s.completedMissions.includes(id);
  }

  upgradeLevel(id: string): number {
    return this.s.upgrades[id] ?? 0;
  }

  setUpgradeLevel(id: string, level: number): void {
    this.s.upgrades[id] = level;
    this.changed();
  }

  setQuality(q: 'low' | 'med' | 'high'): void {
    this.s.settings.quality = q;
    this.changed();
  }

  setSfx(on: boolean): void {
    this.s.settings.sfx = on;
    this.changed();
  }

  setMusic(on: boolean): void {
    this.s.settings.music = on;
    this.changed();
  }

  addPlaytime(sec: number): void {
    this.s.playtimeS += sec;
    this.scheduleSave();
  }

  setSeed(seed: number): void {
    this.s.seed = seed;
    this.changed();
  }
}
