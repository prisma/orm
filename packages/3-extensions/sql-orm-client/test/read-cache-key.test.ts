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
  planContentHash: async (plan: { readonly ast: unknown }) => JSON.stringify(plan.ast),
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
  it('holds the statements it sends, each without the identities of the parents, and the include tree', async () => {
    expect(await hashInputOf(collection.include('posts').state)).toEqual({
      statements: [expect.stringContaining('"users"'), expect.stringContaining('"posts"')],
      selection: undefined,
      includes: [
        {
          relation: 'posts',
          cardinality: 'many',
          kind: 'rows',
          selection: undefined,
          includes: [],
        },
      ],
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

  it('differs by the fields the caller selected', async () => {
    expect(await hashInputOf(collection.select('name').include('posts').state)).not.toEqual(
      await hashInputOf(collection.select('name', 'id').include('posts').state),
    );
  });

  it('differs by the fields the caller selected in an include', async () => {
    const postsSelecting = (...fields: ['title'] | ['title', 'id']) =>
      collection.include('posts', (posts) => posts.select(...fields).include('comments')).state;
    expect(await hashInputOf(postsSelecting('title'))).not.toEqual(
      await hashInputOf(postsSelecting('title', 'id')),
    );
  });

  it('differs by the aggregate of a scalar include that sends no statement', async () => {
    expect(
      await hashInputOf(collection.include('posts', (posts) => posts.limit(0).count()).state),
    ).not.toEqual(
      await hashInputOf(collection.include('posts', (posts) => posts.limit(0).sum('views')).state),
    );
  });

  it('differs by the aggregate of a combine() branch that sends no statement', async () => {
    const total = (sum: boolean) =>
      collection.include('posts', (posts) =>
        posts.combine({ total: sum ? posts.limit(0).sum('views') : posts.limit(0).count() }),
      ).state;
    expect(await hashInputOf(total(true))).not.toEqual(await hashInputOf(total(false)));
  });
});
