/**
 * Typed publish/subscribe event bus.
 * Event maps are plain Record<string, payload> types, e.g.:
 *   type E = { ping: { n: number } };
 */
export class Emitter<E extends Record<string, unknown>> {
  private subs = new Map<string, Set<(p: unknown) => void>>();

  on<K extends keyof E & string>(key: K, fn: (p: E[K]) => void): () => void {
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(fn as (p: unknown) => void);
    return () => {
      set?.delete(fn as (p: unknown) => void);
    };
  }

  emit<K extends keyof E & string>(key: K, payload: E[K]): void {
    this.subs.get(key)?.forEach((fn) => (fn as (p: E[K]) => void)(payload));
  }

  clear(): void {
    this.subs.clear();
  }
}
