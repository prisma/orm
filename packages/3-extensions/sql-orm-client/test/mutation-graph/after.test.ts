import { describe, expect, it } from 'vitest';
import { After } from '../../src/mutation-graph/after';

describe('After', () => {
  it('holds the position it comes from and the position it goes to', () => {
    expect(new After(0, 1)).toMatchObject({ from: 0, to: 1 });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new After(0, 1))).toBe(true);
  });
});
