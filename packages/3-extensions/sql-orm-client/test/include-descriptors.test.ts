import { describe, expect, it } from 'vitest';
import {
  createIncludeCombine,
  createIncludeScalar,
  isCollectionStateCarrier,
  isIncludeCombine,
  isIncludeScalar,
} from '../src/include-descriptors';
import { emptyTableState, getTestContract } from './helpers';

describe('include-descriptors', () => {
  it('createIncludeScalar() omits column when undefined', () => {
    const state = emptyTableState(getTestContract(), 'posts');
    const selector = createIncludeScalar<number>('count', state);

    expect(selector).toEqual({
      kind: 'includeScalar',
      fn: 'count',
      state,
    });
    expect('column' in selector).toBe(false);
  });

  it('createIncludeScalar() preserves explicit columns', () => {
    const state = emptyTableState(getTestContract(), 'posts');
    const selector = createIncludeScalar<number | null>('sum', state, 'views');

    expect(selector).toEqual({
      kind: 'includeScalar',
      fn: 'sum',
      column: 'views',
      state,
    });
  });

  it('isIncludeScalar() validates selector objects and state carriers', () => {
    const state = emptyTableState(getTestContract(), 'posts');

    expect(isIncludeScalar(null)).toBe(false);
    // The operation vocabulary is open: any string names a potentially
    // contributed operation, so validity is shape-only.
    expect(isIncludeScalar({ kind: 'includeScalar', fn: 'median', state })).toBe(true);
    expect(isIncludeScalar({ kind: 'includeScalar', fn: 42, state })).toBe(false);
    expect(isIncludeScalar({ kind: 'includeScalar', fn: 'count', state: {} })).toBe(false);
    expect(isIncludeScalar({ kind: 'includeScalar', fn: 'count', state })).toBe(true);
  });

  it('createIncludeCombine() and isIncludeCombine() handle branch descriptors', () => {
    const state = emptyTableState(getTestContract(), 'posts');
    const combined = createIncludeCombine({
      rows: {
        kind: 'rows',
        state,
      },
    });

    expect(combined.kind).toBe('includeCombine');
    expect(isIncludeCombine(combined)).toBe(true);
    expect(isIncludeCombine({ kind: 'includeCombine', branches: null })).toBe(false);
    expect(isIncludeCombine({ kind: 'unknown', branches: {} })).toBe(false);
  });

  it('isCollectionStateCarrier() validates state shape', () => {
    const state = emptyTableState(getTestContract(), 'posts');

    expect(isCollectionStateCarrier({ state })).toBe(true);
    expect(isCollectionStateCarrier({ state: { filters: [] } })).toBe(false);
    expect(isCollectionStateCarrier({})).toBe(false);
    expect(isCollectionStateCarrier(null)).toBe(false);
  });
});
