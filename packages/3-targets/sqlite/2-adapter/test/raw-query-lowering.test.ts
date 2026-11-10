import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  ParamRef,
  ProjectionItem,
  RawExpr,
  type RawPart,
  RawQueryAst,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { buildOperation, createRawSql, param } from '@internal/sql-relational-core/expression';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql-family/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql, sqliteRawCodecInferer } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'raw-query-test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'raw-query-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false },
                email: { codecId: 'sqlite/text@1', dataType: 'sqlite/text', nullable: false },
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
}) as SqliteContract;

const rawSql = createRawSql(sqliteRawCodecInferer, { contract });

function lower(plan: { readonly ast: Parameters<typeof renderLoweredSql>[0] }) {
  return renderLoweredSql(plan.ast, contract, sqliteCodecDescriptorRegistry);
}

describe('raw-query sqlite lowering', () => {
  it('binds bare-literal and param() interpolations in template order', () => {
    const plan =
      rawSql`SELECT id, email FROM "user" WHERE id > ${7} AND email = ${param('a@b.example', { codecId: 'sqlite/text@1' })}`
        .returnsRow({ id: 'sqlite/integer@1', email: 'sqlite/text@1' })
        .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('SELECT id, email FROM "user" WHERE id > ?1 AND email = ?2');
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 7 },
      { kind: 'literal', value: 'a@b.example' },
    ]);
  });

  it('renders an interpolated expression through its lowering template', () => {
    const lowerEmail = buildOperation({
      method: 'lower',
      args: [ColumnRef.of('user', 'email')],
      returns: { codecId: 'sqlite/text@1', nullable: false },
      lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
    });

    const plan = rawSql`SELECT ${lowerEmail} AS email FROM "user"`
      .returnsRow({ email: 'sqlite/text@1' })
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('SELECT lower("user"."email") AS email FROM "user"');
    expect(lowered.params).toEqual([]);
  });

  it('keeps params in template order across a spliced subquery', () => {
    const active = rawSql`SELECT id FROM "user" WHERE id > ${10}`.returnsRow({
      id: 'sqlite/integer@1',
    });

    const plan = rawSql`WITH active AS (${active}) SELECT id FROM active WHERE id < ${99}`
      .returnsRow({ id: 'sqlite/integer@1' })
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe(
      'WITH active AS (SELECT id FROM "user" WHERE id > ?1) SELECT id FROM active WHERE id < ?2',
    );
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 10 },
      { kind: 'literal', value: 99 },
    ]);
  });

  it('lowers an affected-count mutation statement', () => {
    const plan = rawSql`UPDATE "user" SET email = ${'new@b.example'} WHERE id = ${3}`
      .affectedCount()
      .build();

    const lowered = lower(plan);

    expect(lowered.sql).toBe('UPDATE "user" SET email = ?1 WHERE id = ?2');
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 'new@b.example' },
      { kind: 'literal', value: 3 },
    ]);
  });
});

describe('raw-query sqlite lowering of embedded statements', () => {
  const user = TableSource.named('user');
  const userId = ColumnRef.of('user', 'id');
  const userEmail = ColumnRef.of('user', 'email');
  const integer = (value: number) => ParamRef.of(value, { codec: { codecId: 'sqlite/integer@1' } });
  const text = (value: string) => ParamRef.of(value, { codec: { codecId: 'sqlite/text@1' } });
  const idColumn = { id: { codecId: 'sqlite/integer@1', nullable: false } };

  function selectUsers(where: ParamRef): SelectAst {
    return SelectAst.from(user)
      .addProjection('id', userId)
      .addProjection('email', userEmail)
      .withWhere(BinaryExpr.gt(userId, where));
  }

  function lowerParts(parts: ReadonlyArray<RawPart>) {
    return lower({ ast: RawQueryAst.rows(parts, idColumn) });
  }

  it('splices a select after INSERT INTO without parentheses', () => {
    const lowered = lowerParts([
      'INSERT INTO archive (id, email) ',
      selectUsers(integer(5)),
      ' RETURNING id',
    ]);

    expect(lowered.sql).toBe(
      'INSERT INTO archive (id, email) SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" > ?1 RETURNING id',
    );
    expect(lowered.params).toEqual([{ kind: 'literal', value: 5 }]);
  });

  it('splices a select into a CTE body', () => {
    const lowered = lowerParts(['WITH x AS (', selectUsers(integer(5)), ') SELECT id FROM x']);

    expect(lowered.sql).toBe(
      'WITH x AS (SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" > ?1) SELECT id FROM x',
    );
  });

  it('splices a multi-column select as a derived table', () => {
    const lowered = lowerParts(['SELECT * FROM (', selectUsers(integer(5)), ') AS t']);

    expect(lowered.sql).toBe(
      'SELECT * FROM (SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" > ?1) AS t',
    );
  });

  it('renders embedded UPDATE, DELETE and INSERT with their RETURNING clauses', () => {
    const update = UpdateAst.table(user)
      .withSet({ email: text('new@b.example') })
      .withWhere(BinaryExpr.eq(userId, integer(1)))
      .withReturning([ProjectionItem.of('id', userId)]);
    const remove = DeleteAst.from(user)
      .withWhere(BinaryExpr.eq(userId, integer(2)))
      .withReturning([ProjectionItem.of('id', userId)]);
    const insert = InsertAst.into(user)
      .withRows([{ id: integer(3), email: text('a@b.example') }])
      .withReturning([ProjectionItem.of('id', userId)]);

    expect(lowerParts(['', update, ''])).toEqual({
      sql: 'UPDATE "user" SET "email" = ?1 WHERE "user"."id" = ?2 RETURNING "id"',
      params: [
        { kind: 'literal', value: 'new@b.example' },
        { kind: 'literal', value: 1 },
      ],
    });
    expect(lowerParts(['', remove, ''])).toEqual({
      sql: 'DELETE FROM "user" WHERE "user"."id" = ?1 RETURNING "id"',
      params: [{ kind: 'literal', value: 2 }],
    });
    expect(lowerParts(['', insert, ''])).toEqual({
      sql: 'INSERT INTO "user" ("id", "email") VALUES (?1, ?2) RETURNING "id"',
      params: [
        { kind: 'literal', value: 3 },
        { kind: 'literal', value: 'a@b.example' },
      ],
    });
  });

  it('numbers params before, inside and after the embedded select in template order', () => {
    const lowered = lowerParts([
      'WITH n AS (SELECT ',
      integer(1),
      ' AS v) INSERT INTO archive (id, email) ',
      selectUsers(integer(2)),
      ' AND "user"."id" < ',
      integer(3),
      ' RETURNING id',
    ]);

    expect(lowered.sql).toBe(
      'WITH n AS (SELECT ?1 AS v) INSERT INTO archive (id, email) SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" > ?2 AND "user"."id" < ?3 RETURNING id',
    );
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 1 },
      { kind: 'literal', value: 2 },
      { kind: 'literal', value: 3 },
    ]);
  });

  it('renders a select part inside a RawExpr in expression position', () => {
    const exists = new RawExpr({
      parts: ['EXISTS (', selectUsers(integer(2)), ')'],
      returns: { codecId: 'sqlite/integer@1', nullable: false },
    });
    const outer = SelectAst.from(user)
      .addProjection('id', userId)
      .withWhere(AndExpr.of([BinaryExpr.eq(userEmail, text('a@b.example')), exists]));

    const lowered = lower({ ast: outer });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE ("user"."email" = ?1 AND EXISTS (SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "user" WHERE "user"."id" > ?2))',
    );
    expect(lowered.params).toEqual([
      { kind: 'literal', value: 'a@b.example' },
      { kind: 'literal', value: 2 },
    ]);
  });
});
