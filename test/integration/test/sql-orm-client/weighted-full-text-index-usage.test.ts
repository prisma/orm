/**
 * Does an ORM query that names a weighted full-text index find the right rows
 * and let Postgres use the index? Each query names `indexes.documents_search`
 * in a `where` or `orderBy` callback: on the root collection, inside a
 * fragment, in a custom collection method, in a relation filter and in an
 * include refinement. The last two read `documents` under an alias, so the
 * index's columns have to follow the alias.
 *
 * The index is created from the DDL the migration planner renders for the
 * fixture contract. `EXPLAIN (FORMAT JSON)` on the SQL the ORM sends has to
 * name it, with sequential scans disabled. A negative control restates the
 * fields in one group and must not use it.
 */
import { Collection, orm } from '@internal/sql-orm-client';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { fullTextDocument, websearchToTsquery } from '@internal/target-postgres/full-text';
import { blindCast } from '@internal/utils/casts';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../sql-builder/fixtures/generated/contract';
import { type PlannedIndex, plannedExpressionIndexes } from '../sql-builder/full-text-index-ddl';
import { setupIntegrationTest, timeouts } from '../sql-builder/setup';

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
    const q = websearchToTsquery(query);
    return this.where((_d, { fns, indexes }) =>
      fns.fullTextMatches(indexes.documents_search, q),
    ).orderBy((_d, { fns, indexes }) => fns.fullTextRank(indexes.documents_search, q).desc());
  }
}

describe('ORM search over a weighted full-text index', {
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
    const recording = blindCast<
      typeof real,
      'a recording proxy over the suite runtime; the client only queries through it'
    >({
      ...real,
      query: ((plan: SqlQueryPlan<unknown>, options?: Parameters<typeof real.query>[1]) => {
        captured.push(plan);
        return real.query(plan, options);
      }) satisfies (...args: never[]) => unknown,
    });
    const db = orm({
      runtime: recording,
      context: context(),
      collections: { Document: DocumentCollection },
    }).public;
    return { db, captured };
  }

  async function explainedIndexes(plan: SqlQueryPlan<unknown> | undefined) {
    if (plan === undefined) throw new Error('the query sent no plan');
    const lowered = lower(plan);
    const result = await client().query(`EXPLAIN (FORMAT JSON) ${lowered.sql}`, [
      ...lowered.params,
    ]);
    return indexNames(result.rows[0]['QUERY PLAN']);
  }

  it('finds the matches on the root collection, title matches first', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);

    const rows = await db.Document.select('id', 'title')
      .where((_d, { fns, indexes }) => fns.fullTextMatches(indexes.documents_search, q))
      .orderBy([
        (_d, { fns, indexes }) => fns.fullTextRank(indexes.documents_search, q).desc(),
        (d) => d.id.asc(),
      ])
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
    const q = websearchToTsquery(QUERY);

    const rows = await db.Document.select('id', 'body')
      .where((d) => d.id.in([89, 97]))
      .orderBy((_d, { fns, indexes }) => fns.fullTextRank(indexes.documents_search, q).desc())
      .all();

    expect(rows).toEqual([
      { id: 97, body: 'filler body 97' },
      { id: 89, body: 'a zebra grazes here' },
    ]);
  });

  it('searches through a fragment and a custom collection method', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);
    const search = db.Document.fragment((documents) =>
      documents
        .where((_d, { fns, indexes }) => fns.fullTextMatches(indexes.documents_search, q))
        .orderBy((_d, { fns, indexes }) => fns.fullTextRank(indexes.documents_search, q).desc()),
    );

    const fromFragment = await db.Document.with(search)
      .orderBy((d) => d.id.asc())
      .select('id')
      .limit(3)
      .all();
    const fromMethod = await db.Document.search(QUERY)
      .orderBy((d) => d.id.asc())
      .select('id')
      .limit(3)
      .all();

    expect({ fromFragment, fromMethod }).toEqual({
      fromFragment: [{ id: 97 }, { id: 194 }, { id: 291 }],
      fromMethod: [{ id: 97 }, { id: 194 }, { id: 291 }],
    });
    expect(await explainedIndexes(captured[1])).toContain(searchIndex.name);
  });

  it('searches a related table under its alias, in a relation filter and an include', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);

    const rows = await db.Document.select('id')
      .where((d) =>
        d.children.some((_child, { fns, indexes }) =>
          fns.fullTextMatches(indexes.documents_search, q),
        ),
      )
      .include('children', (children) =>
        children
          .select('id')
          .where((_child, { fns, indexes }) => fns.fullTextMatches(indexes.documents_search, q)),
      )
      .orderBy((d) => d.id.asc())
      .all();

    expect(rows).toEqual([
      { id: 56, children: [{ id: 356 }] },
      { id: 88, children: [{ id: 388 }] },
      { id: 145, children: [{ id: 445 }] },
      { id: 185, children: [{ id: 485 }] },
      { id: 234, children: [{ id: 534 }] },
      { id: 282, children: [{ id: 582 }] },
    ]);
    expect(await explainedIndexes(captured[0])).toContain(searchIndex.name);
  });

  it('does not use the index for a search that restates the fields in one group', async () => {
    const { db, captured } = ormClient();
    const q = websearchToTsquery(QUERY);

    await db.Document.select('id')
      .where((d, { fns }) =>
        fns.fullTextMatches(fullTextDocument([[d.title, d.subtitle, d.body]]), q),
      )
      .all();

    expect(await explainedIndexes(captured[0])).not.toContain(searchIndex.name);
  });
});
