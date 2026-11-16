import type { ActivitySource } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { describeCollectionRead } from '../src/statement-graph/read-graph';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from './collection-fixtures';

const perRelationContract = withoutCapabilityKeys(baseContract, [
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
]);

const source = {
  planContentHash: async (plan: { readonly ast: { readonly from?: unknown } }) =>
    JSON.stringify(plan.ast.from),
} as unknown as ActivitySource;

const { collection } = createCollectionFor('User', perRelationContract);

function hashInputOf(state: CollectionState): Promise<unknown> {
  return describeCollectionRead({
    context: collection.ctx.context,
    state,
    modelName: 'User',
    namespaceId: 'public',
  }).hashInput(source);
}

describe('the cache key of a read with includes, one query per relation', () => {
  it('holds the statements it sends, each without parent keys, and the include tree', async () => {
    expect(await hashInputOf(collection.include('posts').state)).toEqual({
      statements: [expect.stringContaining('"users"'), expect.stringContaining('"posts"')],
      includes: [{ relation: 'posts', cardinality: 'many', kind: 'rows', includes: [] }],
    });
  });

  it('is the same for the same read', async () => {
    const state = collection.include('posts', (posts) => posts.include('comments')).state;
    expect(await hashInputOf(state)).toEqual(await hashInputOf(state));
  });

  it('differs by include', async () => {
    expect(await hashInputOf(collection.include('posts').state)).not.toEqual(
      await hashInputOf(collection.include('profile').state),
    );
  });

  it('differs between an include limited to no rows and no include', async () => {
    expect(
      await hashInputOf(collection.include('posts', (posts) => posts.limit(0)).state),
    ).not.toEqual(await hashInputOf(collection.state));
  });

  it('differs by combine() branch name', async () => {
    const named = (name: string) =>
      collection.include('posts', (posts) => posts.combine({ [name]: posts.count() })).state;
    expect(await hashInputOf(named('total'))).not.toEqual(await hashInputOf(named('count')));
  });

  it('differs between a scalar include and a combine() of that one scalar', async () => {
    expect(
      await hashInputOf(collection.include('posts', (posts) => posts.count()).state),
    ).not.toEqual(
      await hashInputOf(
        collection.include('posts', (posts) => posts.combine({ count: posts.count() })).state,
      ),
    );
  });
});
