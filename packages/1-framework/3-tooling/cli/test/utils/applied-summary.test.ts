import { describe, expect, it } from 'vitest';
import { appliedSummary } from '../../src/utils/applied-summary';

describe('appliedSummary', () => {
  it('counts the operations it ran', () => {
    expect(appliedSummary({ migrations: 1, planned: 3, executed: 3, spaces: 1 })).toBe(
      'Applied 1 migration(s) (3 operation(s)) across 1 contract space(s)',
    );
  });

  it('says why it ran fewer operations than the migrations hold', () => {
    expect(appliedSummary({ migrations: 1, planned: 24, executed: 16, spaces: 1 })).toBe(
      'Applied 1 migration(s) (16 of 24 operation(s); the other 8 had nothing to do, since their postchecks already held) across 1 contract space(s)',
    );
  });
});
