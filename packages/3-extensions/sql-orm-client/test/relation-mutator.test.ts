import { describe, expect, it } from 'vitest';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from '../src/relation-mutator';
import type { RelationMutator } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import type { TestContract } from './helpers';

const posts = createCollectionFor('Post').collection;

describe('relation-mutator', () => {
  it('createRelationMutator() normalizes create/connect/disconnect payloads', () => {
    const mutator = createRelationMutator(posts);

    expect(mutator.create({ id: 1 })).toEqual({
      kind: 'create',
      data: [{ id: 1 }],
    });
    expect(mutator.create([{ id: 1 }, { id: 2 }])).toEqual({
      kind: 'create',
      data: [{ id: 1 }, { id: 2 }],
    });

    expect(mutator.connect({ id: 1 })).toEqual({
      kind: 'connect',
      criteria: [{ id: 1 }],
    });
    expect(mutator.connect([{ id: 1 }, { id: 2 }])).toEqual({
      kind: 'connect',
      criteria: [{ id: 1 }, { id: 2 }],
    });

    expect(mutator.disconnect()).toEqual({ kind: 'disconnect' });
    expect(mutator.disconnect([{ id: 1 }])).toEqual({
      kind: 'disconnect',
      criteria: [{ id: 1 }],
    });
  });

  it('where() returns a mutator narrowed to where, updateAll and deleteAll', () => {
    const narrowed = createRelationMutator(posts).where({ id: 1 });

    expect(Object.keys(narrowed).sort()).toEqual(['deleteAll', 'updateAll', 'where']);
  });

  it('updateAll() and deleteAll() carry the state of the related collection every preceding where() filtered', () => {
    const mutator: RelationMutator<TestContract, 'Post'> = createRelationMutator(posts);

    expect(mutator.updateAll({ id: 2 })).toEqual({
      kind: 'updateAll',
      state: posts.state,
      data: { id: 2 },
    });
    expect(mutator.deleteAll()).toEqual({ kind: 'deleteAll', state: posts.state });
    expect(mutator.where({ id: 1 }).updateAll({ id: 2 })).toEqual({
      kind: 'updateAll',
      state: posts.where({ id: 1 }).state,
      data: { id: 2 },
    });
    expect(
      mutator
        .where({ id: 1 })
        .where((post) => post.title.eq('A'))
        .deleteAll(),
    ).toEqual({
      kind: 'deleteAll',
      state: posts.where({ id: 1 }).where((post) => post.title.eq('A')).state,
    });
  });

  it('where() does not change the mutator it is called on', () => {
    const base = createRelationMutator(posts).where({ id: 1 });
    base.where({ id: 2 });

    expect(base.deleteAll()).toEqual({ kind: 'deleteAll', state: posts.where({ id: 1 }).state });
  });

  it('descriptor and callback guards validate mutation values', () => {
    expect(isRelationMutationDescriptor({ kind: 'updateAll', state: posts.state, data: {} })).toBe(
      true,
    );
    expect(isRelationMutationDescriptor({ kind: 'deleteAll', state: posts.state })).toBe(true);
    expect(isRelationMutationDescriptor(createRelationMutator(posts).where({ id: 1 }))).toBe(false);
    expect(isRelationMutationDescriptor(null)).toBe(false);
    expect(isRelationMutationDescriptor({ kind: 'unknown' })).toBe(false);
    expect(isRelationMutationDescriptor({ kind: 'create', data: [] })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'connect', criteria: [] })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'disconnect' })).toBe(true);
    expect(isRelationMutationDescriptor([{ kind: 'disconnect' }])).toBe(false);
    expect(
      isRelationMutationDescriptor(Object.assign([{ kind: 'disconnect' }], { kind: 'disconnect' })),
    ).toBe(false);

    expect(isRelationMutationCallback(() => ({ kind: 'disconnect' }))).toBe(true);
    expect(isRelationMutationCallback(() => [{ kind: 'disconnect' }])).toBe(true);
    expect(isRelationMutationCallback({})).toBe(false);
  });
});
