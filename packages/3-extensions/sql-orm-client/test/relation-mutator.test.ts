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
  variant(value: string): {
    create(data: object | readonly object[]): unknown;
    connect(criteria: object | readonly object[]): unknown;
    disconnect(criteria?: readonly object[]): unknown;
    where(filter: object): {
      updateAll(data: object): unknown;
      deleteAll(): unknown;
      update(data: object): unknown;
      delete(): unknown;
    };
    updateAll(data: object): unknown;
    deleteAll(): unknown;
    update(data: object): unknown;
    delete(): unknown;
  };
}

interface SingleRowMutator {
  update(data: object): unknown;
  delete(): unknown;
  where(filter: object): SingleRowMutator;
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

  it('where() returns a mutator narrowed to where, update, delete, updateAll and deleteAll', () => {
    const narrowed = createRelationMutator(posts).where({ id: 1 });

    expect(Object.keys(narrowed).sort()).toEqual([
      'delete',
      'deleteAll',
      'update',
      'updateAll',
      'where',
    ]);
  });

  it('update() and delete() carry the state of the related collection every preceding where() filtered', () => {
    const mutator = createRelationMutator(posts) as unknown as SingleRowMutator;

    expect(mutator.update({ title: 'A' })).toEqual({
      kind: 'update',
      state: posts.state,
      data: { title: 'A' },
    });
    expect(mutator.delete()).toEqual({ kind: 'delete', state: posts.state });
    expect(mutator.where({ id: 1 }).update({ title: 'A' })).toEqual({
      kind: 'update',
      state: posts.where({ id: 1 }).state,
      data: { title: 'A' },
    });
    expect(mutator.where({ id: 1 }).where({ title: 'B' }).delete()).toEqual({
      kind: 'delete',
      state: posts.where({ id: 1 }).where({ title: 'B' }).state,
    });
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

    expect(Object.keys(bugs).sort()).toEqual([
      'connect',
      'create',
      'delete',
      'deleteAll',
      'disconnect',
      'update',
      'updateAll',
      'where',
    ]);
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

  it('variant().connect() and disconnect() carry the state of the variant collection', () => {
    const bugs = variantOf(tasks, 'bug');
    const { state } = tasks.variant('bug');

    expect(bugs.connect({ id: 1 })).toEqual({ kind: 'connect', criteria: [{ id: 1 }], state });
    expect(bugs.connect([{ id: 1 }, { id: 2 }])).toEqual({
      kind: 'connect',
      criteria: [{ id: 1 }, { id: 2 }],
      state,
    });
    expect(bugs.disconnect()).toEqual({ kind: 'disconnect', state });
    expect(bugs.disconnect([{ id: 1 }])).toEqual({
      kind: 'disconnect',
      criteria: [{ id: 1 }],
      state,
    });
  });

  it('variant().where(), updateAll() and deleteAll() carry the state of the filtered variant collection', () => {
    const bugs = variantOf(tasks, 'bug');
    const variantTasks = tasks.variant('bug');

    expect(bugs.updateAll({ title: 'Seen' })).toEqual({
      kind: 'updateAll',
      state: variantTasks.state,
      data: { title: 'Seen' },
    });
    expect(bugs.deleteAll()).toEqual({ kind: 'deleteAll', state: variantTasks.state });
    expect(bugs.where({ title: 'Crash' }).deleteAll()).toEqual({
      kind: 'deleteAll',
      state: variantTasks.where({ title: 'Crash' }).state,
    });
    expect(bugs.where({ title: 'Crash' }).update({ title: 'Seen' })).toEqual({
      kind: 'update',
      state: variantTasks.where({ title: 'Crash' }).state,
      data: { title: 'Seen' },
    });
    expect(bugs.delete()).toEqual({ kind: 'delete', state: variantTasks.state });
  });

  it('descriptor and callback guards validate mutation values', () => {
    expect(isRelationMutationDescriptor({ kind: 'updateAll', state: posts.state, data: {} })).toBe(
      true,
    );
    expect(isRelationMutationDescriptor({ kind: 'deleteAll', state: posts.state })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'update', state: posts.state, data: {} })).toBe(
      true,
    );
    expect(isRelationMutationDescriptor({ kind: 'delete', state: posts.state })).toBe(true);
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
