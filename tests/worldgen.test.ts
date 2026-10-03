// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world/worldgen';

describe('generateWorld', () => {
  it('is deterministic and self-consistent for a seed', () => {
    const a = generateWorld(42);
    const b = generateWorld(42);
    expect(a.roads.length).toBe(b.roads.length);
    expect(a.ramps.length).toBe(b.ramps.length);
    expect(a.rings.length).toBe(b.rings.length);
    expect(a.spawn.equals(b.spawn)).toBe(true);
    expect(a.roads.length).toBeGreaterThanOrEqual(20); // 10 gridlines x 2 axes (fixed grid)
  });

  it('different seeds produce different props (roads grid is fixed by design)', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    // Ramp placement is rng-driven => diverges across seeds.
    expect(JSON.stringify(a.ramps)).not.toBe(JSON.stringify(b.ramps));
  });

  it('terrain is flat at spawn and hilly far out', () => {
    const w = generateWorld(7);
    expect(Math.abs(w.height.heightAt(w.spawn.x, w.spawn.z))).toBeLessThan(0.5);
    const far = w.height.heightAt(2500, 2500);
    expect(Math.abs(far)).toBeGreaterThan(1);
  });

  it('spawn sits on a road segment and within bounds', () => {
    const w = generateWorld(7);
    const onRoad = w.roads.some(
      (r) =>
        w.spawn.x >= Math.min(r.x1, r.x2) - 1 &&
        w.spawn.x <= Math.max(r.x1, r.x2) + 1 &&
        w.spawn.z >= Math.min(r.z1, r.z2) - 1 &&
        w.spawn.z <= Math.max(r.z1, r.z2) + 1,
    );
    expect(onRoad).toBe(true);
    expect(w.bounds).toBeGreaterThan(w.cityRadius);
  });

  it('ramps and rings are registered for gameplay', () => {
    const w = generateWorld(7);
    expect(w.ramps.length).toBeGreaterThan(10);
    expect(w.rings.length).toBe(60);
    expect(w.rings.every((r) => r.userData.ringIndex !== undefined)).toBe(true);
  });
});
