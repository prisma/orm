import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

function parsed(modelName: 'User' | 'Post', input: Record<string, unknown>) {
  return parseMutationInput(getTestContext().contract, 'public', modelName, input as never);
}

function printUpdate(input: Record<string, unknown>): string {
  const target = {
    context: getTestContext(),
    state: createCollectionFor('User').collection.where({ id: 1 }).state,
    modelName: 'User',
    namespaceId: 'public',
  };
  return printGraph(updateFirstGraph(target, {}, parsed('User', input).relationMutations));
}

describe('a relation callback that returns an array of operations', () => {
  it('adds the operations in array order', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) => [
          posts.create([{ id: 10, title: 'Hello', views: 0 }]),
          posts.connect({ id: 11 }),
          posts.disconnect([{ id: 12 }]),
        ],
      }),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        'n2 Insert posts <- PayloadData n1 (id->user_id)',
        'n3 Update posts set nothing where id = 11 <- PayloadData n1 (id->user_id)',
        'n4 Update posts set user_id = null where id = 12 <- FilterData n1 (id->user_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('adds nothing for an empty array', () => {
    expect(printUpdate({ posts: () => [] })).toBe(
      ['n1 Find users where id = 1 limit 1', 'result: n1'].join('\n'),
    );
  });

  it('takes a one-element array on a to-one relation as its operation', () => {
    expect(parsed('Post', { author: (author: Mutator) => [author.connect({ id: 1 })] })).toEqual(
      parsed('Post', { author: (author: Mutator) => author.connect({ id: 1 }) }),
    );
  });

  it.each([
    [
      'a nested array',
      'User',
      { posts: (posts: Mutator) => [posts.connect({ id: 11 }), [posts.disconnect()]] },
      'ORM.RELATION_MUTATION_INVALID',
      'Relation field "posts" on model "User" returned a nested array at index 1; return one flat array of mutations',
      { relation: 'posts', model: 'User', problem: 'nested-array', index: 1 },
    ],
    [
      'an element that is not an operation',
      'User',
      { posts: (posts: Mutator) => [posts.connect({ id: 11 }), { id: 12 }] },
      'ORM.RELATION_MUTATION_INVALID',
      'Relation field "posts" on model "User" returned an invalid mutation descriptor at index 1',
      { relation: 'posts', model: 'User', problem: 'invalid-descriptor', index: 1 },
    ],
    [
      'two operations on a to-one relation the parent holds the key for',
      'Post',
      { author: (author: Mutator) => [author.connect({ id: 1 }), author.connect({ id: 2 })] },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'Relation "author" on model "Post" is a to-one relation and takes one operation, not 2',
      { relation: 'author', model: 'Post', reason: 'to-one-relation', operations: 2 },
    ],
    [
      'two operations on a to-one relation the child holds the key for',
      'User',
      { profile: (profile: Mutator) => [profile.disconnect(), profile.disconnect()] },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'Relation "profile" on model "User" is a to-one relation and takes one operation, not 2',
      { relation: 'profile', model: 'User', reason: 'to-one-relation', operations: 2 },
    ],
  ] as const)('rejects %s', (_, modelName, input, code, message, meta) => {
    expect(() => parsed(modelName, input)).toThrow(
      expect.objectContaining({ code, message, meta }),
    );
  });

  it('rejects a disconnect inside an array in create()', () => {
    const target = {
      context: getTestContext(),
      state: createCollectionFor('User').collection.state,
      modelName: 'User',
      namespaceId: 'public',
    };
    const input = {
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
      posts: (posts: Mutator) => [posts.connect({ id: 11 }), posts.disconnect([{ id: 12 }])],
    };

    expect(() => createGraph(target, parsed('User', input))).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
        message: 'disconnect() is only supported in update() nested mutations',
        meta: { kind: 'disconnect', relation: 'posts' },
      }),
    );
  });
});
