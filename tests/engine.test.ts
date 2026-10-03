import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/core/events';

describe('Emitter', () => {
  it('delivers typed payloads to subscribers', () => {
    type E = { ping: { n: number } };
    const em = new Emitter<E>();
    let got = 0;
    em.on('ping', (p) => (got = p.n));
    em.emit('ping', { n: 7 });
    expect(got).toBe(7);
  });

  it('supports unsubscribe', () => {
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

  it('clears all subscribers', () => {
    type E = { ping: { n: number } };
    const em = new Emitter<E>();
    let calls = 0;
    em.on('ping', () => calls++);
    em.clear();
    em.emit('ping', { n: 1 });
    expect(calls).toBe(0);
  });
});
