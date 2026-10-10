import { describe, expect, it } from 'vitest';
import { After } from '../../src/mutation-graph/after';
import { positions } from './statements';

const [from, to] = positions();

describe('After', () => {
  it('holds the position it comes from and the position it goes to', () => {
    expect(new After(from, to)).toMatchObject({ from, to });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new After(from, to))).toBe(true);
  });
});
