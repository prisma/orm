import { describe, expect, it } from 'vitest';
import { parseMutationInput } from '../../src/relation-mutations';
import {
  createGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
} from '../../src/statement-graph/collection-graphs';
import type { Graph } from '../../src/statement-graph/graph';
import {
  baseContract,
  createCollectionFor,
  relatedCollectionOf,
  withoutCapabilityKeys,
} from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

const perRelation = ['outerReferencesInDerivedTables', 'jsonAggWithoutTruncation'];
const withReturning = {
  ...getTestContext(),
  contract: withoutCapabilityKeys(baseContract, perRelation),
};
const withoutReturning = {
  ...getTestContext(),
  contract: withoutCapabilityKeys(baseContract, [...perRelation, 'returning']),
};
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };

function usersWithPosts(context: typeof withReturning) {
  const users = createCollectionFor('User', context.contract).collection.where({ name: 'Ada' });
  return { context, state: users.include('posts').state, modelName: 'User', namespaceId: 'public' };
}

function parsed(context: typeof withReturning, data: Record<string, unknown>) {
  return parseMutationInput(
    context.contract,
    'public',
    'User',
    data as never,
    relatedCollectionOf(context),
  );
}

function asRun(graph: Graph): string {
  graph.removeUnreadFinds();
  return printGraph(graph);
}

describe('writes that return rows with includes, one query per relation', () => {
  describe('with returning', () => {
    const context = withReturning;

    it('create() returns the row from the Insert and reads its posts by its key', () => {
      expect(
        asRun(createGraph(usersWithPosts(context), parsed(context, ada))),
      ).toMatchInlineSnapshot(`
        "n1 Insert users
        n2 FindRelated posts by (id) <- Rows n1
        n3 NestJoin posts <- WholeRows n1, WholeRows n2
        result: n3"
      `);
    });

    it('update() reads the posts of the row the Update returns', () => {
      expect(
        asRun(updateFirstGraph(usersWithPosts(context), { email: 'a@b.c' })),
      ).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada' limit 1
        n2 Update users set email = 'a@b.c' <- FilterData n1 (id->id)
        n3 FindRelated posts by (id) <- Rows n2
        n4 NestJoin posts <- WholeRows n2, WholeRows n3
        result: n4"
      `);
    });

    it('upsert() reads the posts of the row it wrote', () => {
      expect(
        asRun(upsertGraph(usersWithPosts(context), ada, { email: 'a@b.c' }, ['id'])),
      ).toMatchInlineSnapshot(`
        "n1 Insert users on conflict (id) do update
        n2 FindRelated posts by (id) <- Rows n1
        n3 NestJoin posts <- WholeRows n1, WholeRows n2
        result: n3"
      `);
    });

    it('updateAll() with nothing to set reads the rows and their posts', () => {
      expect(asRun(updateAllGraph(usersWithPosts(context), {}, 'rows'))).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada'
        n2 FindRelated posts by (id) <- Rows n1
        n3 NestJoin posts <- WholeRows n1, WholeRows n2
        result: n3"
      `);
    });

    it('delete() reads the posts before the Delete', () => {
      expect(asRun(deleteFirstGraph(usersWithPosts(context)))).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada' limit 1
        n2 FindRelated posts by (id) <- Rows n1
        n3 NestJoin posts <- WholeRows n1, WholeRows n2
        n4 Delete users <- FilterData n1 (id->id)
        n5 DeletedRows <- WholeRows n3, Rows n4
        result: n5"
      `);
    });

    it('deleteAll() reads the posts before the Delete', () => {
      expect(asRun(deleteAllGraph(usersWithPosts(context), 'rows'))).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada'
        n2 FindRelated posts by (id) <- Rows n1
        n3 NestJoin posts <- WholeRows n1, WholeRows n2
        n4 Delete users <- FilterData n1 (id->id)
        n5 DeletedRows <- WholeRows n3, Rows n4
        result: n5"
      `);
    });
  });

  describe('without returning', () => {
    const context = withoutReturning;

    it('create() reads its row back by key, then its posts', () => {
      expect(
        asRun(createGraph(usersWithPosts(context), parsed(context, ada))),
      ).toMatchInlineSnapshot(`
        "n1 Insert users
        n2 FindByKeys users by (id) for create <- Rows n1
        n3 FindRelated posts by (id) <- Rows n2
        n4 NestJoin posts <- WholeRows n2, WholeRows n3
        result: n4"
      `);
    });

    it('update() reads its row back after the Update, then its posts', () => {
      expect(
        asRun(updateFirstGraph(usersWithPosts(context), { email: 'a@b.c' })),
      ).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada' limit 1
        n2 Update users set email = 'a@b.c' <- FilterData n1 (id->id)
        n3 Find users <- FilterData n2 (id->id)
        n4 FindRelated posts by (id) <- Rows n3
        n5 NestJoin posts <- WholeRows n3, WholeRows n4
        result: n5"
      `);
    });

    it('updateAll() reads the rows back after the Update, then their posts', () => {
      expect(
        asRun(updateAllGraph(usersWithPosts(context), { email: 'a@b.c' }, 'rows')),
      ).toMatchInlineSnapshot(`
        "n1 Find users where name = 'Ada'
        n2 Update users set email = 'a@b.c' where name = 'Ada' <- FilterData n1 (id->id)
        n3 Find users <- FilterData n2 (id->id)
        n4 FindRelated posts by (id) <- Rows n3
        n5 NestJoin posts <- WholeRows n3, WholeRows n4
        result: n5"
      `);
    });

    it('upsert() reads its row back by the conflict columns, then its posts', () => {
      expect(
        asRun(upsertGraph(usersWithPosts(context), ada, { email: 'a@b.c' }, ['id'])),
      ).toMatchInlineSnapshot(`
        "n1 Insert users on conflict (id) do update
        n2 FindByKeys users by (id) for upsert <- Rows n1
        n3 FindRelated posts by (id) <- Rows n2
        n4 NestJoin posts <- WholeRows n2, WholeRows n3
        result: n4"
      `);
    });
  });
});
