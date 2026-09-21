/**
 * Does Postgres actually use the GIN index our `@@fullTextIndex` attribute
 * emits, for the SQL our lanes lower? Prisma 7 built such an index and the
 * planner never chose it, so nothing here is assumed:
 *
 *  - every index a positive case relies on is created from the DDL our own op
 *    factory and adapter render for the fixture contract's index node, the
 *    partial one included, never hand-written;
 *  - the queries are the real lowered SQL and bound params of the SQL builder
 *    and the ORM;
 *  - `EXPLAIN (FORMAT JSON)` on exactly that SQL has to name the index;
 *  - two negative controls (a different language, and an index built with the
 *    one-argument `to_tsvector`) must NOT be chosen, so a passing assertion
 *    means something.
 *
 * `enable_seqscan = off` makes this a question of whether the index is usable
 * at all rather than one about cost estimates on a small table.
 */
import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { Collection } from '@internal/sql-orm-client';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { CreateIndexCall } from '@internal/target-postgres/op-factory-call';
import { blindCast } from '@internal/utils/casts';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupIntegrationTest, timeouts } from './setup';

const QUERY = 'zebra';

/** Every `Index Name` anywhere in an EXPLAIN plan tree. */
function indexNames(node: unknown): readonly string[] {
  if (Array.isArray(node)) return node.flatMap(indexNames);
  if (node === null || typeof node !== 'object') return [];
  const record: Record<string, unknown> = { ...node };
  const own = typeof record['Index Name'] === 'string' ? [record['Index Name']] : [];
  return [...own, ...Object.values(record).flatMap(indexNames)];
}

/** Every `Node Type` anywhere in an EXPLAIN plan tree. */
function nodeTypes(node: unknown): readonly string[] {
  if (Array.isArray(node)) return node.flatMap(nodeTypes);
  if (node === null || typeof node !== 'object') return [];
  const record: Record<string, unknown> = { ...node };
  const own = typeof record['Node Type'] === 'string' ? [record['Node Type']] : [];
  return [...own, ...Object.values(record).flatMap(nodeTypes)];
}

describe('full-text index usage', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime, client, contract, context, lower } = setupIntegrationTest();

  const controlAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

  /** The index nodes the fixture's `fullTextIndex(...)` helpers emitted. */
  function fixtureIndexes() {
    const namespace = blindCast<
      { readonly table: Record<string, { readonly indexes: readonly Record<string, unknown>[] }> },
      'the fixture contract is a Postgres schema; only its comment indexes are read here'
    >(contract().storage.namespaces['public']);
    return namespace.table['comments']!.indexes;
  }

  function createIndexCallFor(index: Record<string, unknown>): CreateIndexCall {
    const where = index['where'];
    return new CreateIndexCall(
      'public',
      'comments',
      String(index['name']),
      { expression: String(index['expression']) },
      { type: String(index['type']), ...(where === undefined ? {} : { where: String(where) }) },
    );
  }

  async function createIndexFromContract(index: Record<string, unknown>) {
    const op = await createIndexCallFor(index).toOp(controlAdapter);
    for (const step of op.execute) {
      await client().query(step.sql);
    }
  }

  /** The physical name the fixture's index carries, wire hash included. */
  function indexNamed(prefix: string): string {
    return String(fixtureIndex(prefix)['name']);
  }

  /** `lowerSqlPlan` already unwrapped the renderer's slots to bare bound values. */
  async function explain(sql: string, params: readonly unknown[]) {
    const result = await client().query(`EXPLAIN (FORMAT JSON) ${sql}`, [...params]);
    return result.rows[0]['QUERY PLAN'];
  }

  function loweredOf(plan: SqlQueryPlan<unknown>) {
    return lower(plan);
  }

  beforeAll(async () => {
    for (const index of fixtureIndexes()) await createIndexFromContract(index);

    // A control index over the same column in another configuration: buildable,
    // and not the expression our english query renders.
    await client().query(
      `CREATE INDEX comments_body_simple ON comments USING gin (to_tsvector('simple', "body"))`,
    );

    await client().query(`
      INSERT INTO comments (id, body, subject, post_id)
      SELECT 1000 + n,
             CASE WHEN n % 97 = 0 THEN 'a zebra grazes here' ELSE 'ordinary filler text ' || n END,
             CASE WHEN n % 97 = 0 THEN 'zebra subject' ELSE 'filler subject ' || n END,
             1
      FROM generate_series(1, 600) AS n
    `);
    await client().query('ANALYZE comments');
    await client().query('SET enable_seqscan = off');
  }, timeouts.spinUpPpgDev);

  /** The index node the fixture's `fullTextIndex(...)` emitted under this prefix. */
  function fixtureIndex(prefix: string): Record<string, unknown> {
    const index = fixtureIndexes().find((candidate) => candidate['prefix'] === prefix);
    if (index === undefined) throw new Error(`fixture index ${prefix} is missing`);
    return index;
  }

  async function renderCreateIndex(prefix: string): Promise<string> {
    const op = await createIndexCallFor(fixtureIndex(prefix)).toOp(controlAdapter);
    const [step] = op.execute;
    return step?.sql ?? '';
  }

  it('creates the index from the DDL our own op factory and adapter render', async () => {
    expect(await renderCreateIndex('comments_body_search')).toBe(
      `CREATE INDEX "comments_body_search_7b2cde4d" ON "public"."comments" USING "gin" (to_tsvector('english', "body"))`,
    );
  });

  it('renders the WHERE clause for a partial index the attribute emitted', async () => {
    expect(await renderCreateIndex('comments_body_live')).toBe(
      `CREATE INDEX "comments_body_live_a3f98ae2" ON "public"."comments" USING "gin" (to_tsvector('english', "body")) WHERE (post_id = 1)`,
    );
  });

  it('lowers the predicate to the index expression, with the query bound as a parameter', () => {
    const lowered = loweredOf(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, QUERY))
        .build(),
    );

    // Byte-identical to the index expression in the builder's case. The ORM
    // qualifies the column instead, and still matches: Postgres compares parsed
    // expression trees, not text.
    expect(lowered.sql).toContain(`to_tsvector('english', "body")`);
    expect(lowered.sql).toContain(`websearch_to_tsquery('english', $1)`);
    expect(lowered.params).toEqual([QUERY]);
  });

  it('uses the index for the SQL builder predicate', async () => {
    const lowered = loweredOf(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, QUERY))
        .build(),
    );

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(indexNamed('comments_body_search'));
  });

  it('uses the index when the same predicate is ordered by rank and limited', async () => {
    const lowered = loweredOf(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, QUERY))
        .orderBy((f, fns) => fns.fullTextRank(f.body, QUERY), { direction: 'desc' })
        .limit(10)
        .build(),
    );

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(indexNamed('comments_body_search'));
  });

  it('uses the index for the ORM predicate ordered by rank', async () => {
    const captured: SqlQueryPlan<unknown>[] = [];
    const real = runtime();
    const recording = blindCast<
      typeof real,
      'a recording proxy over the suite runtime; the collection only queries through it'
    >({
      ...real,
      query: ((plan: SqlQueryPlan<unknown>, options?: Parameters<typeof real.query>[1]) => {
        captured.push(plan);
        return real.query(plan, options);
      }) satisfies (...args: never[]) => unknown,
    });

    const comments = new Collection({ runtime: recording, context: context() }, 'Comment', {
      namespaceId: 'public',
    });
    await comments
      .select('id')
      .where((row) => row.body.fullTextMatches(QUERY))
      .orderBy((row) => row.body.fullTextRank(QUERY).desc())
      .all();

    const plan = captured[0];
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    const lowered = loweredOf(plan);
    expect(lowered.sql).toContain(`to_tsvector('english', "comments"."body")`);

    const explained = await explain(lowered.sql, lowered.params);
    expect(indexNames(explained)).toContain(indexNamed('comments_body_search'));
  });

  it('matches the index on a varchar column too', async () => {
    const lowered = loweredOf(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.subject, QUERY))
        .build(),
    );

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(indexNamed('comments_subject_search'));
  });

  it('stores the varchar index with the cast Postgres adds, and matches it anyway', async () => {
    const definition = await client().query(
      `SELECT pg_get_indexdef('${indexNamed('comments_subject_search')}'::regclass) AS def`,
    );

    // Postgres rewrites our `"subject"` to `(subject)::text` inside the stored
    // expression, because `to_tsvector(regconfig, text)` takes text. The query
    // gets the same implicit cast, which is why the two still meet.
    expect(definition.rows[0].def).toContain('(subject)::text');
  });

  it('uses the partial index @@fullTextIndex(where:) emits for a query carrying that predicate', async () => {
    const lowered = loweredOf(
      db()
        .public.comments.select('id')
        .where((f, fns) => fns.fullTextMatches(f.body, QUERY))
        .where((f, fns) => fns.eq(f.post_id, 1))
        .build(),
    );

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(indexNamed('comments_body_live'));
  });

  describe('negative controls', () => {
    it('does not use the english index for a german query', async () => {
      const lowered = loweredOf(
        db()
          .public.comments.select('id')
          .where((f, fns) => fns.fullTextMatches(f.body, QUERY, { language: 'german' }))
          .build(),
      );

      const plan = await explain(lowered.sql, lowered.params);
      expect(indexNames(plan)).not.toContain(indexNamed('comments_body_search'));
      expect(nodeTypes(plan)).toContain('Seq Scan');
    });

    it('does not use an index over the same column in another configuration', async () => {
      const lowered = loweredOf(
        db()
          .public.comments.select('id')
          .where((f, fns) => fns.fullTextMatches(f.body, QUERY))
          .build(),
      );

      const plan = await explain(lowered.sql, lowered.params);
      expect(indexNames(plan)).not.toContain('comments_body_simple');
    });

    // The one-argument `to_tsvector(body)` reads `default_text_search_config`,
    // so it is not IMMUTABLE and Postgres refuses to index it at all. Rendering
    // the configuration into the expression, as the attribute does, is what
    // makes the index possible — not merely what makes it match.
    it('rejects an index over the one-argument to_tsvector outright', async () => {
      await expect(
        client().query('CREATE INDEX c_default_config ON comments USING gin (to_tsvector(body))'),
      ).rejects.toThrow(/IMMUTABLE/);
    });
  });
});
