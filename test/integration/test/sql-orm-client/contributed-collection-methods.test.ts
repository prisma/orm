/**
 * Do the collection methods the Postgres target and pgvector contribute find the right rows, in the right order, at each place a collection is used? The full-text index is created from the DDL the migration planner renders for the fixture contract, and `EXPLAIN (FORMAT JSON)` on the SQL the ORM sends has to name it, with sequential scans disabled.
 */
import { Collection, orm } from '@internal/sql-orm-client';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../sql-builder/fixtures/generated/contract';
import { type PlannedIndex, plannedExpressionIndexes } from '../sql-builder/full-text-index-ddl';
import { setupIntegrationTest, timeouts } from '../sql-builder/setup';
import { withPlanRecording } from './runtime-helpers';

const QUERY = 'zebra';

/** Every `Index Name` anywhere in an EXPLAIN plan tree. */
function indexNames(node: unknown): readonly string[] {
  if (Array.isArray(node)) return node.flatMap(indexNames);
  if (node === null || typeof node !== 'object') return [];
  const record: Record<string, unknown> = { ...node };
  const own = typeof record['Index Name'] === 'string' ? [record['Index Name']] : [];
  return [...own, ...Object.values(record).flatMap(indexNames)];
}

class DocumentCollection extends Collection<Contract, 'Document'> {
  search(query: string) {
    return this.using.documents_search(websearchToTsquery(query));
  }
}

class PostCollection extends Collection<Contract, 'Post'> {
  near(vector: number[]) {
    return this.using.embedding_nearest(vector, 0.5);
  }
}

describe('contributed collection methods', {
  timeout: timeouts.databaseOperation,
}, () => {
  const { runtime, client, contract, context, lower } = setupIntegrationTest();

  let searchIndex: PlannedIndex;

  beforeAll(async () => {
    const [index] = await plannedExpressionIndexes(contract(), 'documents');
    if (index === undefined) throw new Error('the documents table declares no index');
    searchIndex = index;
    await client().query(searchIndex.createSql);

    await client().query(`
      INSERT INTO documents (id, title, subtitle, body, parent_id)
      SELECT n,
             CASE WHEN n % 97 = 0 THEN 'zebra crossing' ELSE 'ordinary title ' || n END,
             CASE WHEN n % 2 = 0 THEN 'subtitle ' || n ELSE NULL END,
             CASE WHEN n % 89 = 0 THEN 'a zebra grazes here' WHEN n % 3 = 0 THEN NULL ELSE 'filler body ' || n END,
             CASE WHEN n > 300 THEN n - 300 ELSE NULL END
      FROM generate_series(1, 600) AS n
    `);
    await client().query('ANALYZE documents');
    await client().query('SET enable_seqscan = off');
  }, timeouts.spinUpPpgDev);

  function ormClient() {
    const captured: SqlQueryPlan<unknown>[] = [];
    const real = runtime();
    const recording = withPlanRecording(real, (plan) => {
      if (!('sql' in plan)) captured.push(plan);
    });
    const client = orm({
      runtime: recording,
      context: context(),
      collections: { Document: DocumentCollection, Post: PostCollection },
    });
    return { db: client.public, captured };
  }

  async function explainedIndexes(plan: SqlQueryPlan<unknown> | undefined) {
    if (plan === undefined) throw new Error('the query sent no plan');
    const lowered = lower(plan);
    const result = await client().query(`EXPLAIN (FORMAT JSON) ${lowered.sql}`, [
      ...lowered.params,
    ]);
    return indexNames(result.rows[0]['QUERY PLAN']);
  }

  it('finds the matches on the root collection, title matches first, and uses the index', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);

    const rows = await db.Document.select('id', 'title')
      .using.documents_search(q)
      .orderBy((d) => d.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 97, title: 'zebra crossing' },
      { id: 194, title: 'zebra crossing' },
      { id: 291, title: 'zebra crossing' },
      { id: 388, title: 'zebra crossing' },
      { id: 485, title: 'zebra crossing' },
      { id: 582, title: 'zebra crossing' },
      { id: 89, title: 'ordinary title 89' },
      { id: 178, title: 'ordinary title 178' },
      { id: 267, title: 'ordinary title 267' },
      { id: 356, title: 'ordinary title 356' },
      { id: 445, title: 'ordinary title 445' },
      { id: 534, title: 'ordinary title 534' },
    ]);
    expect(await explainedIndexes(captured[0])).toContain(searchIndex.name);
  });

  it('ranks a title match above a body match', async () => {
    const { db } = ormClient();

    const rows = await db.Document.select('id', 'body')
      .where((d) => d.id.in([89, 97]))
      .using.documents_search(websearchToTsquery(QUERY))
      .all();

    expect(rows).toEqual([
      { id: 97, body: 'filler body 97' },
      { id: 89, body: 'a zebra grazes here' },
    ]);
  });

  it('keeps an orderBy given before it ahead of the relevance order', async () => {
    const { db } = ormClient();

    const rows = await db.Document.select('id')
      .where((d) => d.id.in([89, 97, 178, 194]))
      .orderBy((d) => d.id.desc())
      .using.documents_search(websearchToTsquery(QUERY))
      .all();

    expect(rows).toEqual([{ id: 194 }, { id: 178 }, { id: 97 }, { id: 89 }]);
  });

  it('gives the same rows after limit, on this in a custom class, inside with and inside a fragment', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);
    const fragment = db.Document.fragment((documents) => documents.using.documents_search(q));

    const afterLimit = await db.Document.limit(3)
      .using.documents_search(q)
      .orderBy((d) => d.id.asc())
      .select('id')
      .all();
    const fromMethod = await db.Document.search(QUERY)
      .orderBy((d) => d.id.asc())
      .select('id')
      .limit(3)
      .all();
    const fromWith = await db.Document.with((d) => d.using.documents_search(q))
      .orderBy((d) => d.id.asc())
      .select('id')
      .limit(3)
      .all();
    const fromFragment = await db.Document.with(fragment)
      .orderBy((d) => d.id.asc())
      .select('id')
      .limit(3)
      .all();

    expect({ afterLimit, fromMethod, fromWith, fromFragment }).toEqual({
      afterLimit: [{ id: 97 }, { id: 194 }, { id: 291 }],
      fromMethod: [{ id: 97 }, { id: 194 }, { id: 291 }],
      fromWith: [{ id: 97 }, { id: 194 }, { id: 291 }],
      fromFragment: [{ id: 97 }, { id: 194 }, { id: 291 }],
    });
    expect(await explainedIndexes(captured[1])).toContain(searchIndex.name);
  });

  it('searches the related rows inside an include refinement', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);

    const rows = await db.Document.select('id')
      .where((d) => d.id.in([56, 88, 89]))
      .include('children', (children) => children.select('id').using.documents_search(q))
      .orderBy((d) => d.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 56, children: [{ id: 356 }] },
      { id: 88, children: [{ id: 388 }] },
      { id: 89, children: [] },
    ]);
    expect(await explainedIndexes(captured[0])).toContain(searchIndex.name);
  });

  describe('pgvector nearest neighbour', () => {
    const near = [1, 0, 0];

    beforeAll(async () => {
      await client().query(
        "INSERT INTO posts (id, title, user_id, views, embedding) VALUES (5, 'No Vector', 3, 0, NULL)",
      );
    });

    it('orders the root collection by distance and keeps the rows within the maximum, binding the vector once', async () => {
      const { db, captured } = ormClient();

      const rows = await db.Post.select('id', 'title').using.embedding_nearest(near, 0.5).all();

      expect(rows).toEqual([
        { id: 1, title: 'Hello World' },
        { id: 4, title: 'Another One' },
      ]);
      const [plan] = captured;
      if (plan === undefined) throw new Error('the query sent no plan');
      expect(lower(plan).sql).toBe(
        'SELECT "posts"."id" AS "id", "posts"."title" AS "title" FROM "public"."posts" WHERE ("posts"."embedding" <=> $1::vector) < $2 ORDER BY "posts"."embedding" <=> $1::vector ASC',
      );
    });

    it('returns the rows with no vector last when no maximum is given', async () => {
      const { db } = ormClient();

      const rows = await db.Post.select('id')
        .where((p) => p.id.in([1, 2, 5]))
        .using.embedding_nearest([0, 1, 0])
        .all();

      expect(rows).toEqual([{ id: 2 }, { id: 1 }, { id: 5 }]);
    });

    it('orders every row when no maximum is given, after where and limit', async () => {
      const { db } = ormClient();

      const rows = await db.Post.select('id')
        .where({ userId: 1 })
        .limit(2)
        .using.embedding_nearest([0, 1, 0])
        .all();

      expect(rows).toEqual([{ id: 2 }, { id: 1 }]);
    });

    it('gives the same rows on this in a custom class, inside with and inside a fragment', async () => {
      const { db } = ormClient();
      const fragment = db.Post.fragment((posts) => posts.using.embedding_nearest(near, 0.5));

      const fromMethod = await db.Post.near(near).select('id').all();
      const fromWith = await db.Post.with((posts) => posts.using.embedding_nearest(near, 0.5))
        .select('id')
        .all();
      const fromFragment = await db.Post.with(fragment).select('id').all();

      expect({ fromMethod, fromWith, fromFragment }).toEqual({
        fromMethod: [{ id: 1 }, { id: 4 }],
        fromWith: [{ id: 1 }, { id: 4 }],
        fromFragment: [{ id: 1 }, { id: 4 }],
      });
    });

    it('finds the nearest related rows inside an include refinement', async () => {
      const { db } = ormClient();

      const rows = await db.User.select('id')
        .where((u) => u.id.in([1, 3]))
        .include('posts', (posts) => posts.select('id').using.embedding_nearest([0, 1, 0]).limit(1))
        .orderBy((u) => u.id.asc())
        .all();

      expect(rows).toEqual([
        { id: 1, posts: [{ id: 2 }] },
        { id: 3, posts: [{ id: 4 }] },
      ]);
    });
  });
});
