import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
  type RelationCollection,
} from '../src/relation-mutator';
import type { RelationMutator } from '../src/types';
import { createCollectionFor } from './collection-fixtures';
import {
  buildMixedPolyContract,
  buildTestContextFromContract,
  createMockRuntime,
  type TestContract,
} from './helpers';

const posts = createCollectionFor('Post').collection;
const tasks = new Collection(
  { runtime: createMockRuntime(), context: buildTestContextFromContract(buildMixedPolyContract()) },
  'Task',
  { namespaceId: 'public' },
);

interface PolymorphicMutator {
  variant(value: string): { create(data: object | readonly object[]): unknown };
}

function variantOf(related: RelationCollection<Contract<SqlStorage>, string>, value: string) {
  return (createRelationMutator(related) as unknown as PolymorphicMutator).variant(value);
}

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

  it('create() carries its options in the descriptor for one row and for an array of rows', () => {
    const mutator = createRelationMutator(posts);

    expect({
      one: mutator.create({ id: 1 }, { onConflict: 'skip' }),
      many: mutator.create([{ id: 1 }, { id: 2 }], { onConflict: 'skip', conflictOn: ['title'] }),
    }).toEqual({
      one: { kind: 'create', data: [{ id: 1 }], options: { onConflict: 'skip' } },
      many: {
        kind: 'create',
        data: [{ id: 1 }, { id: 2 }],
        options: { onConflict: 'skip', conflictOn: ['title'] },
      },
    });
    expect(Object.keys(mutator.create({ id: 1 }))).toEqual(['kind', 'data']);
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

  it('variant().create() carries the variant value with one row or an array', () => {
    const bugs = variantOf(tasks, 'bug');

    expect(Object.keys(bugs)).toEqual(['create']);
    expect(bugs.create({ title: 'Crash' })).toEqual({
      kind: 'create',
      data: [{ title: 'Crash' }],
      variant: 'bug',
    });
    expect(bugs.create([{ title: 'Crash' }, { title: 'Hang' }])).toEqual({
      kind: 'create',
      data: [{ title: 'Crash' }, { title: 'Hang' }],
      variant: 'bug',
    });
  });

  it('variant() refuses an undeclared value with the error of the related collection', () => {
    expect(() => variantOf(tasks, 'story')).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'variant("story") cannot narrow model "Task": the declared discriminator values are "bug", "feature"',
      }),
    );
    expect(() => variantOf(posts, 'story')).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'variant("story") cannot narrow model "Post": it declares no discriminator values',
      }),
    );
  });

  it('variant() on a related collection with a selected variant refuses it with the error of the collection', () => {
    expect(() => variantOf(tasks.variant('bug'), 'feature')).toThrow(
      expect.objectContaining({
        code: 'ORM.OPERATION_UNSUPPORTED',
        message:
          'variant("feature") cannot be called on model "Task" because variant("bug") is already selected; call variant() on the base collection instead',
      }),
    );
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
