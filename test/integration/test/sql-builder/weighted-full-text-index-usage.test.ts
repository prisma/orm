/**
 * Does Postgres use the GIN index a weighted `fullTextIndex` declares, for the
 * SQL the builder lowers from `fns.fullTextMatches` given that index from the
 * table's `indexes`? The index is created from the DDL the migration planner
 * renders for the fixture contract, and `EXPLAIN (FORMAT JSON)` on the real
 * lowered SQL has to name it. Negative controls search a `fullTextDocument`
 * with another grouping, order or language, and must not use it.
 *
 * `enable_seqscan = off` makes this a question of whether the index is usable
 * at all rather than one about cost estimates on a small table.
 */
import { fullTextDocument, websearchToTsquery } from '@internal/target-postgres/full-text';
import { beforeAll, describe, expect, it } from 'vitest';
import { type PlannedIndex, plannedExpressionIndexes } from './full-text-index-ddl';
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

describe('weighted full-text index usage', { timeout: timeouts.databaseOperation }, () => {
  const { db, runtime, client, contract, lower } = setupIntegrationTest();

  let searchIndex: PlannedIndex;

  async function explain(sql: string, params: readonly unknown[]) {
    const result = await client().query(`EXPLAIN (FORMAT JSON) ${sql}`, [...params]);
    return result.rows[0]['QUERY PLAN'];
  }

  beforeAll(async () => {
    const [index] = await plannedExpressionIndexes(contract(), 'documents');
    if (index === undefined) throw new Error('the documents table declares no index');
    searchIndex = index;
    await client().query(searchIndex.createSql);

    await client().query(`
      INSERT INTO documents (id, title, subtitle, body)
      SELECT n,
             CASE WHEN n % 97 = 0 THEN 'zebra crossing' ELSE 'ordinary title ' || n END,
             CASE WHEN n % 2 = 0 THEN 'subtitle ' || n ELSE NULL END,
             CASE WHEN n % 89 = 0 THEN 'a zebra grazes here' WHEN n % 3 = 0 THEN NULL ELSE 'filler body ' || n END
      FROM generate_series(1, 600) AS n
    `);
    await client().query('ANALYZE documents');
    await client().query('SET enable_seqscan = off');
  }, timeouts.spinUpPpgDev);

  const documents = () => db().public.documents;

  const matchesQuery = () =>
    documents()
      .select('id')
      .where((_f, fns) =>
        fns.fullTextMatches(documents().indexes.documents_search, fns.websearchToTsquery(QUERY)),
      )
      .build();

  const document = `(setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A') || setweight(to_tsvector('english', coalesce("body", '')), 'B'))`;
  const documentOf = (alias: string) =>
    document.replaceAll(/"(title|subtitle|body)"/g, `"${alias}"."$1"`);

  it('renders the same search document in the DDL, the schema node and the query', () => {
    expect(searchIndex.expression).toBe(document);
    expect(searchIndex.createSql).toBe(
      `CREATE INDEX "${searchIndex.name}" ON "public"."documents" USING "gin" (${document})`,
    );
    expect(lower(matchesQuery()).sql).toBe(
      `SELECT "id" AS "id" FROM "public"."documents" WHERE ${documentOf('documents')} @@ websearch_to_tsquery('english', $1)`,
    );
  });

  it('is stored by Postgres as the document the query searches', async () => {
    const lowered = lower(matchesQuery());
    const queryDocument = lowered.sql.slice(
      lowered.sql.indexOf('WHERE ') + 'WHERE '.length,
      lowered.sql.lastIndexOf(' @@ '),
    );
    await client().query(
      `CREATE INDEX documents_search_from_query ON documents USING gin (${queryDocument})`,
    );
    const definitions = await client().query(
      `SELECT indexname, regexp_replace(indexdef, '^.* USING ', '') AS body FROM pg_indexes WHERE indexname IN ($1, 'documents_search_from_query') ORDER BY indexname = 'documents_search_from_query'`,
      [searchIndex.name],
    );
    await client().query('DROP INDEX documents_search_from_query');

    expect(definitions.rows).toHaveLength(2);
    expect(definitions.rows[0].body).toBe(
      `gin ((((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(subtitle, ''::text)), 'A'::"char")) || setweight(to_tsvector('english'::regconfig, COALESCE(body, ''::text)), 'B'::"char"))))`,
    );
    expect(definitions.rows[1].body).toBe(definitions.rows[0].body);
  });

  it('searches the same document text over the nullable side of an outer join', () => {
    const joined = lower(
      db()
        .public.users.outerLeftJoin(documents(), (f, fns) => fns.eq(f.users.id, f.documents.id))
        .select('name')
        .where((_f, fns) =>
          fns.fullTextMatches(documents().indexes.documents_search, fns.websearchToTsquery(QUERY)),
        )
        .build(),
    );

    const searchOf = (sql: string) => sql.slice(sql.indexOf('WHERE '));

    expect(searchOf(joined.sql)).toBe(searchOf(lower(matchesQuery()).sql));
  });

  describe('in a self-join', () => {
    const selfJoined = () => {
      const first = documents().as('first');
      const second = documents().as('second');
      return first
        .innerJoin(second, (f, fns) => fns.eq(f.first.id, f.second.id))
        .select('id', (f) => f.first.id)
        .where((_f, fns) =>
          fns.fullTextMatches(second.indexes.documents_search, fns.websearchToTsquery(QUERY)),
        )
        .build();
    };

    it('searches the columns of the aliased table the index was read from', () => {
      expect(lower(selfJoined()).sql).toContain(
        `WHERE ${documentOf('second')} @@ websearch_to_tsquery('english', $1)`,
      );
    });

    it('uses the index of the aliased table', async () => {
      const lowered = lower(selfJoined());

      const plan = await explain(lowered.sql, lowered.params);
      expect(indexNames(plan)).toContain(searchIndex.name);
    });
  });

  it('uses the index for fullTextMatches given the index', async () => {
    const lowered = lower(matchesQuery());

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(searchIndex.name);
  });

  it('finds the rows that match in any of the columns', async () => {
    const rows = await runtime().query(matchesQuery());

    expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual([
      89, 97, 178, 194, 267, 291, 356, 388, 445, 485, 534, 582,
    ]);
  });

  it('uses the index when the predicate is ordered by rank and limited', async () => {
    const lowered = lower(
      documents()
        .select('id')
        .where((_f, fns) =>
          fns.fullTextMatches(documents().indexes.documents_search, fns.websearchToTsquery(QUERY)),
        )
        .orderBy(
          (_f, fns) =>
            fns.fullTextRank(documents().indexes.documents_search, fns.websearchToTsquery(QUERY)),
          { direction: 'desc' },
        )
        .limit(5)
        .build(),
    );

    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(searchIndex.name);
  });

  it('ranks a title match above a body match', async () => {
    const ranked = await runtime().query(
      documents()
        .select('id')
        .select('rank', (_f, fns) =>
          fns.fullTextRank(documents().indexes.documents_search, websearchToTsquery(QUERY)),
        )
        .where((f, fns) => fns.or(fns.eq(f.id, 89), fns.eq(f.id, 97)))
        .orderBy(
          (_f, fns) =>
            fns.fullTextRank(documents().indexes.documents_search, websearchToTsquery(QUERY)),
          { direction: 'desc' },
        )
        .build(),
    );

    expect(ranked.map((row) => row.id)).toEqual([97, 89]);
    expect(ranked[0]!.rank).toBeGreaterThan(ranked[1]!.rank);
  });

  it('uses the index for a fullTextDocument over the same weight groups and language', async () => {
    const lowered = lower(
      documents()
        .select('id')
        .where((f, fns) =>
          fns.fullTextMatches(
            fullTextDocument([[f.title, f.subtitle], [f.body]]),
            fns.websearchToTsquery(QUERY),
          ),
        )
        .build(),
    );

    expect(lowered.sql).toContain(`WHERE ${document} @@`);
    const plan = await explain(lowered.sql, lowered.params);
    expect(indexNames(plan)).toContain(searchIndex.name);
  });

  describe('negative controls', () => {
    it.each([
      [
        'the columns in one group instead of two',
        { groups: 'one' as const, language: 'english' as const },
      ],
      [
        'the groups in another order',
        { groups: 'reversed' as const, language: 'english' as const },
      ],
      ['another language', { groups: 'same' as const, language: 'german' as const }],
    ])('does not use the index for %s', async (_label, variant) => {
      const lowered = lower(
        db()
          .public.documents.select('id')
          .where((f, fns) => {
            const groups =
              variant.groups === 'one'
                ? [[f.title, f.subtitle, f.body]]
                : variant.groups === 'reversed'
                  ? [[f.body], [f.title, f.subtitle]]
                  : [[f.title, f.subtitle], [f.body]];
            return fns.fullTextMatches(fullTextDocument(groups), fns.websearchToTsquery(QUERY), {
              language: variant.language,
            });
          })
          .build(),
      );

      const plan = await explain(lowered.sql, lowered.params);
      expect(indexNames(plan)).not.toContain(searchIndex.name);
    });
  });
});
