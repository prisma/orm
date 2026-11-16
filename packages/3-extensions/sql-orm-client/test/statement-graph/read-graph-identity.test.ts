import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../../src/collection-tables';
import { readGraph } from '../../src/statement-graph/read-graph';
import type { CollectionState } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';

const perRelationContract = withoutCapabilityKeys(baseContract, [
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
]);

const { collection: users } = createCollectionFor('User', perRelationContract);

const tableWithNoIdentity = createStatementTables({
  namespaceId: 'public',
  tableName: 'no_such_table',
});

function readGraphOf(state: CollectionState) {
  return readGraph({
    context: users.ctx.context,
    state,
    modelName: 'User',
    namespaceId: 'public',
  });
}

function refusal(meta: { model: string; table: string; include: string }) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `Cannot load include "${meta.include}" of model "${meta.model}": table "${meta.table}" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.`,
    meta,
  });
}

describe('a read with includes, one query per relation, from a table with no identity', () => {
  it('refuses an include of the top level', () => {
    const state = { ...users.include('posts').state, tables: tableWithNoIdentity };

    expect(() => readGraphOf(state)).toThrow(
      refusal({ model: 'User', table: 'no_such_table', include: 'posts' }),
    );
  });

  it('refuses an include of a nested level', () => {
    const state = users.include('posts', (posts) => posts.include('comments')).state;
    const [posts] = state.includes;
    if (posts === undefined) {
      throw new Error('expected the posts include');
    }
    const nestedWithNoIdentity = {
      ...state,
      includes: [{ ...posts, nested: { ...posts.nested, tables: tableWithNoIdentity } }],
    };

    expect(() => readGraphOf(nestedWithNoIdentity)).toThrow(
      refusal({ model: 'Post', table: 'no_such_table', include: 'comments' }),
    );
  });
});
