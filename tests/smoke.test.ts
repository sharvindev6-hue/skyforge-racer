import { describe, expect, it } from 'vitest';

describe('project smoke', () => {
  it('has a working vitest + ts pipeline', () => {
    expect(1 + 1).toBe(2);
  });
});
