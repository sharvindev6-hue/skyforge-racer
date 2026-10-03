/**
 * Deterministic seeded RNG (mulberry32). Same seed => same world.
 */
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

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.g();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(arr: readonly T[]): T {
    const i = Math.floor(this.g() * arr.length);
    return arr[i] as T;
  }
}
