import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const withoutReturning = withoutCapabilityKeys(baseContract, [
  'returning',
  'insertOnConflictTarget',
]);
const context = { ...getTestContext(), contract: withoutReturning };

function graphOf(
  target: Parameters<typeof createGraph>[0],
  data: Record<string, unknown>,
): ReturnType<typeof createGraph> {
  return createGraph(
    target,
    parseMutationInput(
      target.context.contract,
      target.namespaceId,
      target.modelName,
      data as never,
    ),
  );
}

function targetOf(modelName: 'User' | 'Post') {
  const { collection } = createCollectionFor(modelName, withoutReturning);
  return { context, state: collection.where({ id: 1 }).state, modelName, namespaceId: 'public' };
}

const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const hello = { id: 10, title: 'Hello', views: 0 };

describe('nested write graphs on a contract without capability "returning"', () => {
  it('inserts each row another node reads, and reads it back by its key', () => {
    const graph = graphOf(
      {
        ...targetOf('Post'),
        state: createCollectionFor('Post', withoutReturning).collection.state,
      },
      { ...hello, author: (author: Mutator) => author.create(ada) },
    );

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert users',
        'n2 FindByKeys users by (id) for create <- Rows n1',
        'n3 Insert posts <- PayloadData n2 (id->user_id)',
        'n4 FindByKeys posts by (id) for create <- Rows n3',
        'result: n4',
      ].join('\n'),
    );
  });

  it('inserts children no node reads in one Insert with the key of the parent', () => {
    const graph = graphOf(
      {
        ...targetOf('User'),
        state: createCollectionFor('User', withoutReturning).collection.state,
      },
      {
        ...ada,
        posts: (posts: Mutator) => posts.create([hello, { id: 11, title: 'b', views: 1 }]),
      },
    );

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert users',
        'n2 FindByKeys users by (id) for create <- Rows n1',
        'n3 Insert posts 2 rows <- PayloadData n2 (id->user_id)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('updates the parent, runs the child operations with the keys the Update gives, then reads the parent back by its key', () => {
    const parsed = parseMutationInput(withoutReturning, 'public', 'User', {
      posts: (posts: Mutator) => posts.connect({ id: 10 }),
    } as never);

    expect(
      printGraph(updateFirstGraph(targetOf('User'), { name: 'Ada' }, parsed.relationMutations)),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        "n2 Update users set name = 'Ada' <- FilterData n1 (id->id)",
        'n3 Update posts set nothing where id = 10 <- PayloadData n2 (id->user_id)',
        'n4 Find users <- FilterData n2 (id->id)',
        'result: n4',
      ].join('\n'),
    );
  });
});
