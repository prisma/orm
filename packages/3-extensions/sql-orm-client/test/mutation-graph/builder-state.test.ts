import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import {
  createAllGraph,
  createAllVariantGraph,
  createGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
} from '../../src/mutation-graph/collection-graphs';
import type { Graph } from '../../src/mutation-graph/graph';
import { mtiCreateContextOf } from '../../src/mutation-graph/storage-rows';
import { parseMutationInput } from '../../src/relation-mutations';
import { emptyState, type RelationMutator } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { buildMixedPolyContract, buildTestContextFromContract, getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const withoutReturning = withoutCapabilityKeys(baseContract, ['returning']);
const contexts = {
  'with returning': getTestContext(),
  'without returning': { ...getTestContext(), contract: withoutReturning },
};
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const withState = { state: true };

function usersOf(context: (typeof contexts)['with returning'], includePosts = false) {
  const users = createCollectionFor('User', context.contract).collection.where({ name: 'Ada' });
  const state = includePosts ? users.include('posts').state : users.state;
  return { context, state, modelName: 'User', namespaceId: 'public' };
}

function parsed(context: (typeof contexts)['with returning'], data: Record<string, unknown>) {
  return parseMutationInput(context.contract, 'public', 'User', data as never);
}

function print(graph: Graph): string {
  return printGraph(graph, withState);
}

describe.each(Object.entries(contexts))(
  'state edges of the graphs builders build, %s',
  (_, context) => {
    it('createAllGraph', () => {
      expect(
        print(createAllGraph(usersOf(context, true), [ada], undefined, 'rows')),
      ).toMatchSnapshot();
    });

    it('upsertGraph', () => {
      expect(
        print(upsertGraph(usersOf(context), ada, { name: 'Ada L.' }, ['email'])),
      ).toMatchSnapshot();
    });

    it('updateAllGraph', () => {
      expect(
        print(updateAllGraph(usersOf(context, true), { name: 'Grace' }, 'rows')),
      ).toMatchSnapshot();
      expect(print(updateAllGraph(usersOf(context), { name: 'Grace' }, 'count'))).toMatchSnapshot();
    });

    it('deleteAllGraph', () => {
      expect(print(deleteAllGraph(usersOf(context, true), 'rows'))).toMatchSnapshot();
      expect(print(deleteAllGraph(usersOf(context), 'count'))).toMatchSnapshot();
    });

    it('deleteFirstGraph', () => {
      expect(print(deleteFirstGraph(usersOf(context, true)))).toMatchSnapshot();
    });

    it('updateFirstGraph with relation operations', () => {
      const relations = parsed(context, {
        invitedBy: (inviter: Mutator) => inviter.connect({ id: 2 }),
        posts: (posts: Mutator) => posts.create([{ id: 10, title: 'Hello', views: 0 }]),
        tags: (tags: Mutator) => tags.connect([{ id: 5 }]),
      }).relationMutations;

      expect(
        print(updateFirstGraph(usersOf(context, true), { name: 'Grace' }, relations)),
      ).toMatchSnapshot();
    });

    it('createGraph with relation operations', () => {
      const data = parsed(context, {
        ...ada,
        invitedBy: (inviter: Mutator) => inviter.create({ id: 2, name: 'Grace', email: 'g@x.com' }),
        posts: (posts: Mutator) => posts.create([{ id: 10, title: 'Hello', views: 0 }]),
        tags: (tags: Mutator) => tags.create([{ id: 5, name: 'math' }]),
      });

      expect(print(createGraph(usersOf(context, true), data))).toMatchSnapshot();
    });
  },
);

describe('state edges of the graph createAllVariantGraph builds', () => {
  it('createAllVariantGraph', () => {
    const contract = buildMixedPolyContract();
    const tables = createCollectionTables(contract, 'public', 'Task');
    const features = tables.variants.get('feature');
    const collection = {
      context: buildTestContextFromContract(contract),
      state: { ...emptyState(tables), variantValue: 'feature' },
      modelName: 'Task',
      namespaceId: 'public',
    };
    const mti = mtiCreateContextOf(collection);
    if (features === undefined || mti === undefined) {
      throw new Error('the fixture has an MTI variant feature');
    }
    const rows = [
      { title: 'Dark mode', priority: 1 },
      { title: 'Export to PDF', priority: 3 },
    ];

    expect(print(createAllVariantGraph(collection, features, mti, rows))).toMatchSnapshot();
  });
});
