import { describe, expect, it } from 'vitest';
import { hasNestedMutationCallbacks, hasRelationFields } from '../src/relation-mutations';
import { getTestContract } from './helpers';

const contract = getTestContract();
const connectPost = (posts: { connect: (criterion: Record<string, unknown>) => unknown }) =>
  posts.connect({ id: 1 });

describe('hasNestedMutationCallbacks', () => {
  it('detects callbacks only on relation fields', () => {
    expect(hasNestedMutationCallbacks(contract, 'public', 'User', { posts: connectPost })).toBe(
      true,
    );
    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', {
        posts: { kind: 'connect', criteria: [{ id: 1 }] },
      }),
    ).toBe(false);
    expect(
      hasNestedMutationCallbacks(contract, 'public', 'User', { name: () => ({ kind: 'connect' }) }),
    ).toBe(false);
  });
});

describe('hasRelationFields', () => {
  it('detects a relation field with any value that is not undefined', () => {
    expect(hasRelationFields(contract, 'public', 'User', { posts: connectPost })).toBe(true);
    expect(hasRelationFields(contract, 'public', 'User', { posts: [] })).toBe(true);
    expect(hasRelationFields(contract, 'public', 'User', { posts: undefined, name: 'Ada' })).toBe(
      false,
    );
  });
});
