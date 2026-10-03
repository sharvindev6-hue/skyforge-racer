import { describe, expect, it } from 'vitest';
import { keyToAxis } from '../src/core/input';

describe('keyToAxis', () => {
  it('maps opposing keys to a -1..1 axis', () => {
    expect(keyToAxis({ KeyA: true, KeyD: false }, 'KeyA', 'KeyD')).toBe(-1);
    expect(keyToAxis({ KeyA: false, KeyD: true }, 'KeyA', 'KeyD')).toBe(1);
    expect(keyToAxis({ KeyA: true, KeyD: true }, 'KeyA', 'KeyD')).toBe(0);
    expect(keyToAxis({}, 'KeyA', 'KeyD')).toBe(0);
  });
});
