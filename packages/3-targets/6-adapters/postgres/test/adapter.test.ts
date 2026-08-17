import type { StorageHashBase } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  CodecJsonValueProjection,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  ExistsExpr,
  FunctionCallExpr,
  FunctionSource,
  InsertAst,
  InsertOnConflict,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  NativeJsonValueProjection,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  type SqlQueryable,
  SubqueryExpr,
  TableSource,
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { PostgresSchema } from '@internal/target-postgres/types';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                createdAt: {
                  codecId: 'pg/timestamptz-temporal@1',
                  nativeType: 'timestamptz',
                  nullable: false,
                },
                profile: { codecId: 'pg/jsonb@1', nativeType: 'jsonb', nullable: true },
                metadata: { codecId: 'pg/json@1', nativeType: 'json', nullable: true },
                vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                userId: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as PostgresContract;

describe('Postgres adapter', () => {
  const adapter = createPostgresAdapter();

  it('lowers rich select statements with aggregates, JSON, and subqueries', () => {
    const subquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
        ProjectionItem.of(
          'payload',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'email',
              new NativeJsonValueProjection(ColumnRef.of('user', 'email')),
            ),
            JsonObjectExpr.entry('count', new NativeJsonValueProjection(AggregateExpr.count())),
          ]),
        ),
        ProjectionItem.of('firstPostId', SubqueryExpr.of(subquery)),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), LiteralExpr.of('a@example.com')))
      .withOrderBy([]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toContain('json_build_object');
    expect(lowered.sql).toContain(
      '(SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id") AS "firstPostId"',
    );
    expect(lowered.sql).toContain(`WHERE "user"."email" = 'a@example.com'`);
  });

  it.each([
    {
      name: 'codec',
      projection: new CodecJsonValueProjection(ColumnRef.of('user', 'email'), {
        codecId: 'pg/text@1',
      }),
    },
    {
      name: 'native',
      projection: new NativeJsonValueProjection(ColumnRef.of('user', 'email')),
    },
    {
      name: 'document',
      projection: new JsonDocumentProjection(ColumnRef.of('user', 'email')),
    },
  ])('renders $name JSON value projections as structural pass-throughs', ({ projection }) => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of(
        'object',
        JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', projection)]),
      ),
      ProjectionItem.of('array', JsonArrayAggExpr.of(projection)),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toBe(
      `SELECT json_build_object('value', "user"."email") AS "object", json_agg("user"."email") AS "array" FROM "user"`,
    );
  });

  it('renders nested scalar projection expressions with exact precedence', () => {
    const decision = CaseExpr.of(
      [
        {
          condition: BinaryExpr.eq(
            FunctionCallExpr.of('lower', [ColumnRef.of('user', 'email')]),
            ParamRef.of('a@example.com', { codec: { codecId: 'pg/text@1' } }),
          ),
          value: CastExpr.as(
            FunctionCallExpr.of('concat', [
              ColumnRef.of('user', 'email'),
              ParamRef.of('!', { codec: { codecId: 'pg/text@1' } }),
            ]),
            'text',
          ),
        },
        {
          condition: NullCheckExpr.isNull(ColumnRef.of('user', 'profile')),
          value: FunctionCallExpr.of('coalesce', [
            ColumnRef.of('user', 'email'),
            LiteralExpr.of('missing'),
          ]),
        },
      ],
      CastExpr.as(ParamRef.of('fallback', { codec: { codecId: 'pg/text@1' } }), 'text'),
    );
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('zero', FunctionCallExpr.of('random', [])),
      ProjectionItem.of('decision', NullCheckExpr.isNotNull(decision)),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });

    expect(lowered.sql).toBe(
      `SELECT random() AS "zero", CASE WHEN lower("user"."email") = $1 THEN CAST(concat("user"."email", $2) AS text) WHEN "user"."profile" IS NULL THEN coalesce("user"."email", 'missing') ELSE CAST($3 AS text) END IS NOT NULL AS "decision" FROM "user"`,
    );
  });

  it.each([
    {
      name: 'function call',
      expression: FunctionCallExpr.of('lower', [ColumnRef.of('user', 'email')]),
      sql: 'lower("user"."email")',
    },
    {
      name: 'cast',
      expression: CastExpr.as(ColumnRef.of('user', 'email'), 'text'),
      sql: 'CAST("user"."email" AS text)',
    },
    {
      name: 'searched CASE',
      expression: CaseExpr.of([
        {
          condition: BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1)),
          value: LiteralExpr.of('found'),
        },
      ]),
      sql: `CASE WHEN "user"."id" = 1 THEN 'found' END`,
    },
  ])('treats $name expressions as atomic under null checks', ({ expression, sql }) => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('value', NullCheckExpr.isNotNull(expression)),
    ]);

    expect(adapter.lower(ast, { contract, params: [] }).sql).toBe(
      `SELECT ${sql} IS NOT NULL AS "value" FROM "user"`,
    );
  });

  it('lowers insert, update, and delete statements with returning clauses', () => {
    const insertAst = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        },
        {
          id: ParamRef.of(2, { name: 'id2', codec: { codecId: 'pg/int4@1' } }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    const updateAst = UpdateAst.table(TableSource.named('user'))
      .withSet({
        email: ParamRef.of('b@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
      })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('email', ColumnRef.of('user', 'email'))]);
    const deleteAst = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);

    expect(adapter.lower(insertAst, { contract }).sql).toContain(
      'ON CONFLICT ("email") DO UPDATE SET "email" = excluded."email"',
    );
    expect(adapter.lower(updateAst, { contract }).sql).toBe(
      'UPDATE "user" SET "email" = $1 WHERE "user"."id" = $2 RETURNING "user"."email"',
    );
    expect(adapter.lower(deleteAst, { contract }).sql).toBe(
      'DELETE FROM "user" WHERE "user"."id" = $1 RETURNING "user"."id"',
    );
  });

  it('throws on unsupported AST nodes and invalid insert rows', () => {
    const unsupported = {
      kind: 'unsupported',
      collectParamRefs: () => [],
      collectRefs: () => ({ tables: [], columns: [] }),
    } as unknown as AnyQueryAst;
    expect(() => adapter.lower(unsupported, { contract, params: [] })).toThrow(
      'Unsupported AST node kind: unsupported',
    );
    expect(() =>
      adapter.lower(InsertAst.into(TableSource.named('user')).withRows([]), {
        contract,
        params: [],
      }),
    ).toThrow('INSERT requires at least one row');
  });

  it('lowers distinct, exists, null checks, and typed JSON parameters in WHERE clauses', () => {
    const existsSubquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const vectorLength = new OperationExpr({
      method: 'vectorLength',
      self: ColumnRef.of('user', 'vector'),
      args: [],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'vector_length({{self}})',
      },
    });
    const scalarSubquery = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'userId'), ColumnRef.of('user', 'id')));
    const ast = SelectAst.from(TableSource.named('user'))
      .withDistinctOn([ColumnRef.of('user', 'email')])
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        AndExpr.of([
          ExistsExpr.notExists(existsSubquery),
          NullCheckExpr.isNull(vectorLength),
          NullCheckExpr.isNotNull(SubqueryExpr.of(scalarSubquery)),
          BinaryExpr.eq(
            ColumnRef.of('user', 'profile'),
            ParamRef.of({ active: true }, { name: 'profile', codec: { codecId: 'pg/jsonb@1' } }),
          ),
          BinaryExpr.eq(
            ColumnRef.of('user', 'metadata'),
            ParamRef.of({ source: 'test' }, { name: 'metadata', codec: { codecId: 'pg/json@1' } }),
          ),
          BinaryExpr.in(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
          BinaryExpr.notIn(ColumnRef.of('user', 'id'), ListExpression.fromValues([])),
        ]),
      );

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.sql).toBe(
      [
        'SELECT DISTINCT ON ("user"."email") "user"."id" AS "id"',
        'FROM "user"',
        'WHERE (NOT EXISTS (SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id")',
        'AND (vector_length("user"."vector")) IS NULL',
        'AND ((SELECT "post"."id" AS "id" FROM "post" WHERE "post"."userId" = "user"."id")) IS NOT NULL',
        'AND "user"."profile" = $1::jsonb',
        'AND "user"."metadata" = $2::json',
        'AND FALSE',
        'AND TRUE)',
      ].join(' '),
    );
  });

  it('lowers default-value inserts with DO NOTHING conflict handling', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([{}])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doNothing());

    expect(adapter.lower(ast, { contract, params: [] }).sql).toBe(
      'INSERT INTO "user" DEFAULT VALUES ON CONFLICT ("email") DO NOTHING',
    );
  });

  it('renders bigint, date, array, object, and undefined literals in projections', () => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('bigintValue', LiteralExpr.of(12n)),
      ProjectionItem.of('createdAtLiteral', LiteralExpr.of(new Date('2024-01-01T00:00:00.000Z'))),
      ProjectionItem.of('arrayValue', LiteralExpr.of([1, 'two'])),
      ProjectionItem.of('jsonValue', LiteralExpr.of({ ok: true })),
      ProjectionItem.of('missingValue', LiteralExpr.of(undefined)),
    ]);

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toBe(
      `SELECT 12 AS "bigintValue", '2024-01-01T00:00:00.000Z' AS "createdAtLiteral", ARRAY[1, 'two'] AS "arrayValue", '{"ok":true}' AS "jsonValue", NULL AS "missingValue" FROM "user"`,
    );
  });

  it('renders ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)', () => {
    const ast = SelectAst.from(TableSource.named('post')).withProjection([
      ProjectionItem.of('title', ColumnRef.of('post', 'title')),
      ProjectionItem.of(
        'rn',
        WindowFuncExpr.rowNumber({
          partitionBy: [ColumnRef.of('post', 'title')],
          orderBy: [OrderByItem.desc(ColumnRef.of('post', 'views'))],
        }),
      ),
    ]);

    const sql = adapter.lower(ast, { contract, params: [] }).sql;
    expect(sql).toEqual(
      'SELECT "post"."title" AS "title", ROW_NUMBER() OVER (PARTITION BY "post"."title" ORDER BY "post"."views" DESC) AS "rn" FROM "post"',
    );
  });

  it('renders DISTINCT, GROUP BY, HAVING, and OR clauses', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([
        ProjectionItem.of('email', ColumnRef.of('user', 'email')),
        ProjectionItem.of('cnt', AggregateExpr.count()),
      ])
      .withDistinct()
      .withGroupBy([ColumnRef.of('user', 'email')])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)))
      .withWhere(OrExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))]));

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain('SELECT DISTINCT');
    expect(sql).toContain('GROUP BY "user"."email"');
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain('WHERE ("user"."id" = 1)');
  });

  it('renders TableSource with alias', () => {
    const ast = SelectAst.from(TableSource.named('user', 'u')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('u', 'id')),
    ]);

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain('FROM "user" AS "u"');
  });

  it.each([
    {
      name: 'without arguments or alias',
      source: FunctionSource.of('rows', []),
      sql: 'SELECT 1 AS "value" FROM rows()',
    },
    {
      name: 'with arguments and alias',
      source: FunctionSource.of('rows', [LiteralExpr.of(1), LiteralExpr.of(2)], { alias: 'r' }),
      sql: 'SELECT 1 AS "value" FROM rows(1, 2) AS "r"',
    },
    {
      name: 'with ordinality',
      source: FunctionSource.of('rows', []).withOrdinality(),
      sql: 'SELECT 1 AS "value" FROM rows() WITH ORDINALITY',
    },
    {
      name: 'with returned-column aliases',
      source: FunctionSource.of('rows', [], {
        alias: 'r',
        columnAliases: ['value', 'position'],
      }),
      sql: 'SELECT 1 AS "value" FROM rows() AS "r"("value", "position")',
    },
  ])('renders function sources $name', ({ source, sql }) => {
    const ast = SelectAst.from(source).withProjection([
      ProjectionItem.of('value', LiteralExpr.of(1)),
    ]);

    expect(adapter.lower(ast, { contract, params: [] }).sql).toBe(sql);
  });

  it('renders rewritten parameterized function sources with ordinality and column aliases', () => {
    const originalArg = ParamRef.of([1, 2], {
      name: 'input',
      codec: { codecId: 'pg/int4@1', many: true },
    });
    const replacementArg = ParamRef.of([3, 4], {
      name: 'rewrittenInput',
      codec: { codecId: 'pg/int4@1', many: true },
    });
    const source = FunctionSource.of('unnest', [originalArg], {
      alias: 'u',
      columnAliases: ['element', 'ord'],
    })
      .withOrdinality()
      .rewrite({ paramRef: () => replacementArg });

    expect(source).toBeInstanceOf(FunctionSource);
    if (!(source instanceof FunctionSource)) {
      throw new Error('Expected FunctionSource');
    }
    expect(source.args).toEqual([replacementArg]);

    const ast = SelectAst.from(source).withProjection([
      ProjectionItem.of('element', ColumnRef.of('u', 'element')),
    ]);

    expect(adapter.lower(ast, { contract, params: [] }).sql).toBe(
      'SELECT "u"."element" AS "element" FROM unnest($1::integer[]) WITH ORDINALITY AS "u"("element", "ord")',
    );
  });

  it('renders empty OR as FALSE', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(OrExpr.false());

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain('WHERE FALSE');
  });

  it('exposes profile metadata: capabilities and readMarker', () => {
    expect(adapter.profile.target).toBe('postgres');
    expect(adapter.profile.id).toBe('postgres/default@1');
    expect(adapter.profile.capabilities['postgres']).toMatchObject({ lateral: true });
    expect(adapter.profile.capabilities['sql']).toMatchObject({ returning: true });
    expect(typeof adapter.profile.readMarker).toBe('function');
  });

  it('postgres adapter reports sql.scalarList capability', () => {
    expect(adapter.profile.capabilities['sql']).toMatchObject({ scalarList: true });
  });

  it('postgres adapter reports sql.checkConstraint capability', () => {
    expect(adapter.profile.capabilities['sql']).toMatchObject({ checkConstraint: true });
  });

  it('readMarker returns no-table when the information_schema probe yields no rows', async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const queryable: SqlQueryable = {
      execute: async () => ({ affectedRows: 0 }),
      async *query<Row>(request: { sql: string; params?: readonly unknown[] }): AsyncIterable<Row> {
        calls.push({ sql: request.sql, params: request.params });
        yield* [];
      },
    };

    const result = await adapter.profile.readMarker(queryable);

    expect(result).toEqual({ kind: 'no-table' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('"information_schema"."tables"');
    expect(calls[0]?.params).toEqual(['prisma_contract', 'marker']);
  });

  it('readMarker returns absent when the table exists but holds no row for this space', async () => {
    let call = 0;
    const queryable: SqlQueryable = {
      execute: async () => ({ affectedRows: 0 }),
      async *query<Row>() {
        call += 1;
        const rows = call === 1 ? [{ '1': 1 }] : [];
        for (const row of rows) {
          yield row as Row;
        }
      },
    };

    const result = await adapter.profile.readMarker(queryable);

    expect(result).toEqual({ kind: 'absent' });
  });

  it('honours an overridden profile id from PostgresAdapterOptions', () => {
    const customAdapter = createPostgresAdapter({ profileId: 'postgres/custom@9' });
    expect(customAdapter.profile.id).toBe('postgres/custom@9');
  });

  it(
    'contributes parameterized codec descriptors through the unified codecs slot',
    async () => {
      // The contributor protocol is unified: every codec descriptor (parameterized or not) flows through the runtime descriptor's `codecs:` slot. The adapter class itself no longer carries a dedicated parameterized-codec accessor — descriptor metadata lives on the runtime descriptor exported by the package.
      // Uses `timeouts.coldTransformImport` because the dynamic `await import('../src/exports/runtime')` triggers vitest's first-pass transform of the runtime module graph (control stack, codec descriptors, descriptor-meta), which can exceed the default 200ms hook timeout on cold CI workers.
      const runtimeMod = await import('../src/exports/runtime');
      const descriptors = runtimeMod.default.codecs();
      expect(descriptors.length).toBeGreaterThan(0);
      const ids = descriptors.map((d: { codecId: string }) => d.codecId);
      expect(ids).toEqual(expect.arrayContaining(['pg/numeric@1', 'pg/timestamptz-temporal@1']));
      for (const descriptor of descriptors) {
        expect(descriptor.paramsSchema).toBeDefined();
      }
    },
    timeouts.coldTransformImport,
  );

  it('renders DO UPDATE SET with param-ref values and UPDATE SET with column-ref values', () => {
    const insertWithParamUpdate = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ParamRef.of('b@example.com', {
            name: 'replacement',
            codec: { codecId: 'pg/text@1' },
          }),
        }),
      );

    const insertSql = adapter.lower(insertWithParamUpdate, { contract, params: [] }).sql;
    expect(insertSql).toMatch(/ON CONFLICT \("email"\) DO UPDATE SET "email" = \$\d+/);

    const updateWithColumnRef = UpdateAst.table(TableSource.named('user'))
      .withSet({ email: ColumnRef.of('user', 'email') })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      );
    const updateSql = adapter.lower(updateWithColumnRef, { contract, params: [] }).sql;
    expect(updateSql).toContain(`SET "email" = "user"."email"`);
  });

  it('throws when a default-values INSERT targets a table missing from contract storage', () => {
    const ast = InsertAst.into(TableSource.named('missing_table')).withRows([{}, {}]);

    expect(() => adapter.lower(ast, { contract, params: [] })).toThrow(
      /INSERT target table not found in contract storage: missing_table/,
    );
  });

  it('throws when ON CONFLICT DO UPDATE SET has no assignments', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        },
      ])
      .withOnConflict(InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({}));

    expect(() => adapter.lower(ast, { contract, params: [] })).toThrow(
      /INSERT onConflict do-update-set requires at least one assignment/,
    );
  });

  it('throws when UPDATE has no SET assignments', () => {
    const ast = UpdateAst.table(TableSource.named('user')).withSet({});

    expect(() => adapter.lower(ast, { contract, params: [] })).toThrow(
      /UPDATE requires at least one SET assignment/,
    );
  });

  it('renders multi-row DEFAULT VALUES inserts as `(DEFAULT, …), (DEFAULT, …)` over the contract column order', () => {
    // Phase C deleted the schema-typed JSON tests that incidentally covered `renderInsert`'s multi-row default-values branch (lines walking `defaultColumns` and emitting `(DEFAULT, …)` per row). Pin the multi-row default-values shape here so the function-coverage % stays above the 95% threshold.
    const ast = InsertAst.into(TableSource.named('user')).withRows([{}, {}]);
    const sql = adapter.lower(ast, { contract, params: [] }).sql;
    // Column order matches the contract storage column order; every value is `DEFAULT` per row.
    expect(sql).toMatch(/^INSERT INTO "user" \("[^"]+"(, "[^"]+")*\) VALUES /);
    expect(sql).toContain(' VALUES (DEFAULT, ');
    // Two rows of defaults, separated by `, `.
    expect((sql.match(/\(DEFAULT, /g) ?? []).length).toBe(2);
  });

  it('renders BinaryExpr.in over a non-empty ListExpression as `IN ($1, $2, …)`', () => {
    // The empty-list branch of `renderListLiteral` is covered by the existing distinct/exists/null-check test. Pin the non-empty list shape so `.values.map(...)` (param-ref + literal arms) stays covered after the Phase C test deletions.
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.in(
          ColumnRef.of('user', 'id'),
          ListExpression.of([
            ParamRef.of(1, { name: 'a', codec: { codecId: 'pg/int4@1' } }),
            LiteralExpr.of(2),
          ]),
        ),
      );

    const sql = adapter.lower(ast, { contract, params: [] }).sql;
    expect(sql).toContain('"user"."id" IN ($1, 2)');
  });

  it('readMarker parses a present marker row into a ContractMarkerRecord', async () => {
    const markerRow = {
      core_hash: 'test-core',
      profile_hash: 'test-profile',
      contract_json: { storage: {}, target: 'postgres' },
      canonical_version: 1,
      updated_at: new Date('2026-04-30T00:00:00Z'),
      app_tag: 'app',
      meta: {},
      invariants: ['inv-1'],
    };
    let call = 0;
    const queryable: SqlQueryable = {
      execute: async () => ({ affectedRows: 0 }),
      async *query<Row>() {
        call += 1;
        const rows = call === 1 ? [{ '1': 1 }] : [markerRow];
        for (const row of rows) {
          yield row as Row;
        }
      },
    };

    const result = await adapter.profile.readMarker(queryable);

    expect(result.kind).toBe('present');
    if (result.kind !== 'present') return;
    expect(result.record.storageHash).toBe('test-core');
    expect(result.record.profileHash).toBe('test-profile');
    expect(result.record.appTag).toBe('app');
    expect(result.record.invariants).toEqual(['inv-1']);
  });

  it('parenthesizes composite expressions before appending IS NULL / IS NOT NULL', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        AndExpr.of([
          NullCheckExpr.isNull(BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))),
          NullCheckExpr.isNotNull(
            OrExpr.of([BinaryExpr.eq(ColumnRef.of('user', 'id'), LiteralExpr.of(1))]),
          ),
          NullCheckExpr.isNull(ColumnRef.of('user', 'email')),
        ]),
      );

    const sql = adapter.lower(ast, { contract, params: [] }).sql;

    expect(sql).toContain('("user"."id" = 1) IS NULL');
    expect(sql).toContain('(("user"."id" = 1)) IS NOT NULL');
    expect(sql).toContain('"user"."email" IS NULL');
  });

  it('qualifies table identifiers from the namespace coordinate on TableSource', () => {
    const publicContract = {
      ...contract,
      storage: new SqlStorage({
        storageHash: 'test-core-public' as StorageHashBase<'test-core-public'>,
        namespaces: {
          public: new PostgresSchema({
            id: 'public',
            entries: {
              table: contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table ?? {},
            },
          }),
        },
      }),
    } as PostgresContract;
    const ast = SelectAst.from(TableSource.named('user', undefined, 'public')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
    ]);
    const sql = adapter.lower(ast, { contract: publicContract, params: [] }).sql;
    expect(sql).toBe('SELECT "user"."id" AS "id" FROM "public"."user"');
  });
});
