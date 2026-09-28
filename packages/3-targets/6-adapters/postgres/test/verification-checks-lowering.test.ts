import { cfExpr, cfTable, exprSelect } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  columnDefaultAst,
  columnExistsAst,
  columnNullabilityAst,
  columnTypeAst,
  constraintExistsAst,
  extensionExistsAst,
  indexExistsAst,
  noNullValuesAst,
  rlsEnabledAst,
  rlsPolicyExistsAst,
  tableExistsAst,
  tableIsEmptyAst,
  tablePrimaryKeyAst,
} from '@internal/target-postgres/contract-free';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const ctx = { contract: {} as PostgresContract };

describe('tableExistsAst lowering — to_regclass verification checks', () => {
  it('lowers tableAbsent to SELECT to_regclass($1) IS NULL', async () => {
    const ast = tableExistsAst('public', 'users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NULL AS "result"');
    expect(result.params).toEqual(['"public"."users"']);
  });

  it('lowers tablePresent to SELECT to_regclass($1) IS NOT NULL', async () => {
    const ast = tableExistsAst('public', 'users').tablePresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NOT NULL AS "result"');
    expect(result.params).toEqual(['"public"."users"']);
  });

  it('binds the unqualified name for the unbound namespace', async () => {
    const ast = tableExistsAst('__unbound__', 'users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe('SELECT (to_regclass($1)) IS NULL AS "result"');
    expect(result.params).toEqual(['"users"']);
  });
});

describe('constraintExistsAst lowering — pg_constraint EXISTS checks', () => {
  const innerBody =
    'SELECT 1 AS "one" FROM "pg_constraint" AS "c" ' +
    'INNER JOIN "pg_namespace" AS "n" ON "n"."oid" = "c"."connamespace"';

  it('lowers constraintPresent with table scope to EXISTS with three bound params', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: 'public',
      table: 'user',
    }).constraintPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = $2 AND "c"."conrelid" = to_regclass($3))' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey', 'public', '"public"."user"']);
  });

  it('lowers constraintAbsent to NOT EXISTS over the same body', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: 'public',
    }).constraintAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT NOT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = $2)' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey', 'public']);
  });

  it('uses current_schema() for the unbound namespace', async () => {
    const ast = constraintExistsAst({
      constraintName: 'user_pkey',
      schema: '__unbound__',
    }).constraintPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT EXISTS (${innerBody} WHERE ` +
        '("c"."conname" = $1 AND "n"."nspname" = current_schema())' +
        ') AS "result"',
    );
    expect(result.params).toEqual(['user_pkey']);
  });
});

describe('RLS check builders — policy/table names bind as parameters (injection safety)', () => {
  // The recording-lowerer op tests (rls-ops / rls-disable-rename-ops) can only
  // pin WHICH check AST an op lowers; the real safety property — that the
  // policy name reaches SQL as a bound parameter, never interpolated — lives
  // here, rendered through the real adapter lowerer.
  const dangerousName = "read'; DROP POLICY x; --";

  it('rlsPolicyExistsAst.policyPresent binds schema, table, and policy name', async () => {
    const ast = rlsPolicyExistsAst({
      schema: 'public',
      table: 'profiles',
      policyName: dangerousName,
    }).policyPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT EXISTS (SELECT 1 AS "one" FROM "pg_policies" WHERE ' +
        '("schemaname" = $1 AND "tablename" = $2 AND "policyname" = $3)) AS "result"',
    );
    expect(result.params).toEqual(['public', 'profiles', dangerousName]);
    // The name is a bound param — it never appears in the SQL text.
    expect(result.sql).not.toContain(dangerousName);
  });

  it('rlsPolicyExistsAst.policyAbsent binds the policy name too', async () => {
    const ast = rlsPolicyExistsAst({
      schema: 'public',
      table: 'profiles',
      policyName: dangerousName,
    }).policyAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.params).toEqual(['public', 'profiles', dangerousName]);
    expect(result.sql).not.toContain(dangerousName);
  });

  it('rlsEnabledAst binds schema and table as parameters', async () => {
    const result = await adapter.lowerToExecuteRequest(
      rlsEnabledAst('public', 'profiles').rlsEnabled(),
      ctx,
    );
    expect(result.params).toEqual(['public', 'profiles']);
  });
});

describe('exprSelect lowering — leftJoin and limit (D3 catalog-check shapes)', () => {
  it('renders LEFT JOIN with an expression ON clause', async () => {
    const inner = exprSelect()
      .from(cfTable('pg_index', 'i'))
      .leftJoin(
        cfTable('pg_class', 'c2'),
        cfExpr.columnRef('c2', 'oid').eqExpr(cfExpr.columnRef('i', 'indexrelid')),
      )
      .project('one', cfExpr.lit(1));
    const ast = exprSelect().project('result', cfExpr.exists(inner)).build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT EXISTS (SELECT 1 AS "one" FROM "pg_index" AS "i" ' +
        'LEFT JOIN "pg_class" AS "c2" ON "c2"."oid" = "i"."indexrelid") AS "result"',
    );
    expect(result.params).toEqual([]);
  });

  it('renders LIMIT 1 inside a NOT EXISTS body (tableIsEmptyCheck shape)', async () => {
    const inner = exprSelect().from(cfTable('user')).project('one', cfExpr.lit(1)).limit(1);
    const ast = exprSelect().project('result', cfExpr.notExists(inner)).build();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "user" LIMIT 1) AS "result"',
    );
    expect(result.params).toEqual([]);
  });
});

describe('D3 catalog check builders — lowering pins', () => {
  const infoSchemaBody =
    'SELECT 1 AS "one" FROM "information_schema"."columns" WHERE ' +
    '("table_schema" = $1 AND "table_name" = $2 AND "column_name" = $3';

  it('columnExistsAst.columnPresent — information_schema.columns EXISTS', async () => {
    const ast = columnExistsAst({
      schema: 'public',
      table: 'user',
      column: 'email',
    }).columnPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(`SELECT EXISTS (${infoSchemaBody})) AS "result"`);
    expect(result.params).toEqual(['public', 'user', 'email']);
  });

  it('columnExistsAst.columnAbsent — NOT EXISTS variant', async () => {
    const ast = columnExistsAst({
      schema: 'public',
      table: 'user',
      column: 'email',
    }).columnAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(`SELECT NOT EXISTS (${infoSchemaBody})) AS "result"`);
    expect(result.params).toEqual(['public', 'user', 'email']);
  });

  it('columnNullabilityAst — is_nullable bound as a param', async () => {
    const ast = columnNullabilityAst({
      schema: 'public',
      table: 'user',
      column: 'email',
      nullable: false,
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT EXISTS (${infoSchemaBody} AND "is_nullable" = $4)) AS "result"`,
    );
    expect(result.params).toEqual(['public', 'user', 'email', 'NO']);
  });

  it('columnNullabilityAst nullable:true binds YES', async () => {
    const ast = columnNullabilityAst({
      schema: 'public',
      table: 'user',
      column: 'bio',
      nullable: true,
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.params).toEqual(['public', 'user', 'bio', 'YES']);
  });

  it('columnTypeAst — format_type via cfExpr.fn with NOT attisdropped', async () => {
    const ast = columnTypeAst({
      schema: 'public',
      table: 'user',
      column: 'age',
      expectedType: 'integer',
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT EXISTS (SELECT 1 AS "one" FROM "pg_attribute" AS "a" ' +
        'INNER JOIN "pg_class" AS "c" ON "c"."oid" = "a"."attrelid" ' +
        'INNER JOIN "pg_namespace" AS "n" ON "n"."oid" = "c"."relnamespace" WHERE ' +
        '("n"."nspname" = $1 AND "c"."relname" = $2 AND "a"."attname" = $3 ' +
        'AND (format_type("a"."atttypid", "a"."atttypmod")) = $4 ' +
        'AND NOT ("a"."attisdropped"))) AS "result"',
    );
    expect(result.params).toEqual(['public', 'user', 'age', 'integer']);
  });

  it('columnDefaultAst.defaultPresent / defaultAbsent / noDefault', async () => {
    const builder = columnDefaultAst({ schema: 'public', table: 'user', column: 'created_at' });

    const present = await adapter.lowerToExecuteRequest(builder.defaultPresent(), ctx);
    expect(present.sql).toBe(
      `SELECT EXISTS (${infoSchemaBody} AND "column_default" IS NOT NULL)) AS "result"`,
    );
    expect(present.params).toEqual(['public', 'user', 'created_at']);

    const absent = await adapter.lowerToExecuteRequest(builder.defaultAbsent(), ctx);
    expect(absent.sql).toBe(
      `SELECT EXISTS (${infoSchemaBody} AND "column_default" IS NULL)) AS "result"`,
    );

    const noDefault = await adapter.lowerToExecuteRequest(builder.noDefault(), ctx);
    expect(noDefault.sql).toBe(
      `SELECT NOT EXISTS (${infoSchemaBody} AND "column_default" IS NOT NULL)) AS "result"`,
    );
  });

  it('tablePrimaryKeyAst — pg_index joins with LEFT JOIN and bare boolean conjunct', async () => {
    const pkBody =
      'SELECT 1 AS "one" FROM "pg_index" AS "i" ' +
      'INNER JOIN "pg_class" AS "c" ON "c"."oid" = "i"."indrelid" ' +
      'INNER JOIN "pg_namespace" AS "n" ON "n"."oid" = "c"."relnamespace" ' +
      'LEFT JOIN "pg_class" AS "c2" ON "c2"."oid" = "i"."indexrelid" WHERE ' +
      '("n"."nspname" = $1 AND "c"."relname" = $2 AND "i"."indisprimary"';

    const present = await adapter.lowerToExecuteRequest(
      tablePrimaryKeyAst({ schema: 'public', table: 'user' }).pkPresent(),
      ctx,
    );
    expect(present.sql).toBe(`SELECT EXISTS (${pkBody})) AS "result"`);
    expect(present.params).toEqual(['public', 'user']);

    const scoped = await adapter.lowerToExecuteRequest(
      tablePrimaryKeyAst({
        schema: 'public',
        table: 'user',
        constraintName: 'user_pkey',
      }).pkAbsent(),
      ctx,
    );
    expect(scoped.sql).toBe(`SELECT NOT EXISTS (${pkBody} AND "c2"."relname" = $3)) AS "result"`);
    expect(scoped.params).toEqual(['public', 'user', 'user_pkey']);
  });

  it('tableIsEmptyAst — schema-qualified user table with LIMIT 1', async () => {
    const ast = tableIsEmptyAst('public', 'user');
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "public"."user" LIMIT 1) AS "result"',
    );
    expect(result.params).toEqual([]);
  });

  it('tableIsEmptyAst — unbound namespace renders an unqualified table', async () => {
    const ast = tableIsEmptyAst('__unbound__', 'user');
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "user" LIMIT 1) AS "result"',
    );
  });

  it('noNullValuesAst — user-table data check', async () => {
    const ast = noNullValuesAst({ schema: 'public', table: 'user', column: 'email' });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "public"."user" WHERE "email" IS NULL) AS "result"',
    );
    expect(result.params).toEqual([]);
  });

  it('extensionExistsAst — pg_extension extname param', async () => {
    const present = await adapter.lowerToExecuteRequest(
      extensionExistsAst('vector').extensionPresent(),
      ctx,
    );
    expect(present.sql).toBe(
      'SELECT EXISTS (SELECT 1 AS "one" FROM "pg_extension" WHERE "extname" = $1) AS "result"',
    );
    expect(present.params).toEqual(['vector']);

    const absent = await adapter.lowerToExecuteRequest(
      extensionExistsAst('vector').extensionAbsent(),
      ctx,
    );
    expect(absent.sql).toBe(
      'SELECT NOT EXISTS (SELECT 1 AS "one" FROM "pg_extension" WHERE "extname" = $1) AS "result"',
    );
  });

  it('indexExistsAst — to_regclass over the qualified index name', async () => {
    const absent = await adapter.lowerToExecuteRequest(
      indexExistsAst('public', 'user_email_idx').indexAbsent(),
      ctx,
    );
    expect(absent.sql).toBe('SELECT (to_regclass($1)) IS NULL AS "result"');
    expect(absent.params).toEqual(['"public"."user_email_idx"']);

    const present = await adapter.lowerToExecuteRequest(
      indexExistsAst('public', 'user_email_idx').indexPresent(),
      ctx,
    );
    expect(present.sql).toBe('SELECT (to_regclass($1)) IS NOT NULL AS "result"');
    expect(present.params).toEqual(['"public"."user_email_idx"']);
  });
});
