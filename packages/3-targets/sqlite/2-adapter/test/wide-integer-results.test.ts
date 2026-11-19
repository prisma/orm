import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { CodecRef } from '@internal/framework-components/codec';
import {
  AggregateExpr,
  type AnyQueryAst,
  BinaryExpr,
  CastExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  FunctionCallExpr,
  IdentifierRef,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql-family/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const integerColumn = { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false };
const bigintColumn = { codecId: 'sqlite/bigint@1', dataType: 'sqlite/integer', nullable: true };

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
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
            counter: {
              columns: { id: integerColumn, big: bigintColumn, capped: bigintColumn },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
            reading: {
              columns: { id: integerColumn, counter_id: integerColumn, amount: bigintColumn },
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

const BIGINT: CodecRef = { codecId: 'sqlite/bigint@1' };
const BIGINT_NUMBER: CodecRef = { codecId: 'sqlite/bigintnumber@1' };
const INTEGER: CodecRef = { codecId: 'sqlite/integer@1' };

const WIDE = 2n ** 62n;

const counter = TableSource.named('counter');
const reading = TableSource.named('reading');
const id = ProjectionItem.of('id', ColumnRef.of('counter', 'id'), INTEGER);
const big = ProjectionItem.of('big', ColumnRef.of('counter', 'big'), BIGINT);

describe('64-bit integers a statement returns, run against SQLite', () => {
  let database: DatabaseSync;

  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE counter (id INTEGER PRIMARY KEY, big INTEGER, capped INTEGER);
      CREATE TABLE reading (id INTEGER PRIMARY KEY, counter_id INTEGER, amount INTEGER);
      INSERT INTO counter (id, big, capped) VALUES (1, 10, 7), (2, 2, NULL), (3, ${WIDE}, ${WIDE});
      INSERT INTO reading (id, counter_id, amount) VALUES (1, 1, ${WIDE}), (2, 2, 5), (3, 3, 40);
    `);
  });

  afterEach(() => {
    database.close();
  });

  function lower(ast: AnyQueryAst): string {
    return renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry).sql;
  }

  function run(ast: AnyQueryAst): unknown[] {
    const { sql, params } = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);
    const values = params.map((param) =>
      param.kind === 'literal' ? (param.value as SQLInputValue) : null,
    );
    return database
      .prepare(sql)
      .all(...values)
      .map((row) => ({ ...row }));
  }

  describe('a select', () => {
    it('returns both 64-bit codecs as decimal text and leaves other columns as they are', () => {
      const ast = SelectAst.from(counter)
        .withProjection([
          id,
          big,
          ProjectionItem.of('capped', ColumnRef.of('counter', 'capped'), BIGINT_NUMBER),
        ])
        .withOrderBy([OrderByItem.asc(ColumnRef.of('counter', 'id'))]);

      expect(run(ast)).toEqual([
        { id: 1, big: '10', capped: '7' },
        { id: 2, big: '2', capped: null },
        { id: 3, big: WIDE.toString(), capped: WIDE.toString() },
      ]);
    });

    it('does not cast an aggregate its descriptor already returns as text', () => {
      const total = CastExpr.as(AggregateExpr.sum(ColumnRef.of('counter', 'big')), 'text');
      const ast = SelectAst.from(counter).withProjection([
        ProjectionItem.of('total', total, BIGINT),
      ]);

      expect(lower(ast)).toBe(
        'SELECT CAST(SUM("counter"."big") AS text) AS "total" FROM "counter"',
      );
    });

    it('casts the least and greatest value, which carry the column codec', () => {
      const ast = SelectAst.from(counter).withProjection([
        ProjectionItem.of('greatest', AggregateExpr.max(ColumnRef.of('counter', 'big')), BIGINT),
      ]);

      expect(run(ast)).toEqual([{ greatest: WIDE.toString() }]);
    });

    it('keeps the integer inside a derived table and a subquery, where SQL compares it', () => {
      const inner = SelectAst.from(counter).withProjection([big]);
      const ast = SelectAst.from(DerivedTableSource.as('wide', inner))
        .withProjection([ProjectionItem.of('big', ColumnRef.of('wide', 'big'), BIGINT)])
        .withWhere(
          BinaryExpr.gt(
            ColumnRef.of('wide', 'big'),
            SubqueryExpr.of(
              SelectAst.from(reading)
                .withProjection([
                  ProjectionItem.of('amount', ColumnRef.of('reading', 'amount'), BIGINT),
                ])
                .withWhere(BinaryExpr.eq(ColumnRef.of('reading', 'id'), LiteralExpr.of(2))),
            ),
          ),
        )
        .withOrderBy([OrderByItem.asc(ColumnRef.of('wide', 'big'))]);

      expect(lower(ast)).toBe(
        'SELECT CAST("wide"."big" AS TEXT) AS "big" FROM (SELECT "counter"."big" AS "big" FROM "counter") AS "wide" WHERE "wide"."big" > (SELECT "reading"."amount" AS "amount" FROM "reading" WHERE "reading"."id" = 2) ORDER BY "wide"."big" ASC',
      );
      expect(run(ast)).toEqual([{ big: '10' }, { big: WIDE.toString() }]);
    });
  });

  describe('a select ordered by the name of a column it returns as text', () => {
    it('orders by the integer when the column is named without its table', () => {
      const ast = SelectAst.from(counter)
        .withProjection([ProjectionItem.of('big', IdentifierRef.of('big'), BIGINT)])
        .withOrderBy([OrderByItem.asc(IdentifierRef.of('big'))]);

      expect(lower(ast)).toBe(
        'SELECT CAST("big" AS TEXT) AS "big" FROM "counter" ORDER BY "counter"."big" ASC',
      );
      expect(run(ast)).toEqual([{ big: '2' }, { big: '10' }, { big: WIDE.toString() }]);
    });

    it('orders by the integer of an aliased table', () => {
      const ast = SelectAst.from(TableSource.named('counter', 'c'))
        .withProjection([ProjectionItem.of('big', IdentifierRef.of('big'), BIGINT)])
        .withOrderBy([OrderByItem.desc(IdentifierRef.of('big'))]);

      expect(run(ast)).toEqual([{ big: WIDE.toString() }, { big: '10' }, { big: '2' }]);
    });

    it('orders by the integer of a derived table', () => {
      const inner = SelectAst.from(counter).withProjection([big]);
      const ast = SelectAst.from(DerivedTableSource.as('wide', inner))
        .withProjection([ProjectionItem.of('big', IdentifierRef.of('big'), BIGINT)])
        .withOrderBy([OrderByItem.asc(IdentifierRef.of('big'))]);

      expect(run(ast)).toEqual([{ big: '2' }, { big: '10' }, { big: WIDE.toString() }]);
    });

    it('orders by the expression the name is an alias of', () => {
      const ast = SelectAst.from(counter)
        .withProjection([ProjectionItem.of('amount', ColumnRef.of('counter', 'big'), BIGINT)])
        .withOrderBy([OrderByItem.asc(IdentifierRef.of('AMOUNT'))]);

      expect(lower(ast)).toBe(
        'SELECT CAST("counter"."big" AS TEXT) AS "amount" FROM "counter" ORDER BY "counter"."big" ASC',
      );
      expect(run(ast)).toEqual([{ amount: '2' }, { amount: '10' }, { amount: WIDE.toString() }]);
    });

    it('orders by the integer of the one joined table that has the column', () => {
      const ast = SelectAst.from(counter)
        .withJoins([
          JoinAst.inner(
            reading,
            new EqColJoinOn(ColumnRef.of('reading', 'counter_id'), ColumnRef.of('counter', 'id')),
          ),
        ])
        .withProjection([ProjectionItem.of('amount', IdentifierRef.of('amount'), BIGINT)])
        .withOrderBy([OrderByItem.asc(IdentifierRef.of('amount'))]);

      expect(lower(ast)).toBe(
        'SELECT CAST("amount" AS TEXT) AS "amount" FROM "counter" INNER JOIN "reading" ON "reading"."counter_id" = "counter"."id" ORDER BY "reading"."amount" ASC',
      );
      expect(run(ast)).toEqual([{ amount: '5' }, { amount: '40' }, { amount: WIDE.toString() }]);
    });

    it('returns the integer when it cannot tell which source the column is from', () => {
      const ast = SelectAst.from(counter)
        .withJoins([
          JoinAst.inner(
            TableSource.named('unlisted'),
            new EqColJoinOn(ColumnRef.of('unlisted', 'counter_id'), ColumnRef.of('counter', 'id')),
          ),
        ])
        .withProjection([ProjectionItem.of('extra', IdentifierRef.of('extra'), BIGINT)])
        .withOrderBy([OrderByItem.asc(IdentifierRef.of('extra'))]);

      expect(lower(ast)).toBe(
        'SELECT "extra" AS "extra" FROM "counter" INNER JOIN "unlisted" ON "unlisted"."counter_id" = "counter"."id" ORDER BY "extra" ASC',
      );
    });

    it('returns the integer when an expression may read the alias', () => {
      const ast = SelectAst.from(counter)
        .withProjection([ProjectionItem.of('amount', ColumnRef.of('counter', 'big'), BIGINT)])
        .withOrderBy([OrderByItem.asc(FunctionCallExpr.of('abs', [IdentifierRef.of('amount')]))]);

      expect(lower(ast)).toBe(
        'SELECT "counter"."big" AS "amount" FROM "counter" ORDER BY abs("amount") ASC',
      );
    });

    it('returns text when an expression names the column the alias repeats', () => {
      const ast = SelectAst.from(counter)
        .withProjection([ProjectionItem.of('big', IdentifierRef.of('big'), BIGINT)])
        .withWhere(BinaryExpr.gt(IdentifierRef.of('big'), LiteralExpr.of(5)))
        .withOrderBy([OrderByItem.asc(FunctionCallExpr.of('abs', [IdentifierRef.of('big')]))]);

      expect(run(ast)).toEqual([{ big: '10' }, { big: WIDE.toString() }]);
    });
  });

  describe('a write that returns rows', () => {
    const target = TableSource.named('counter', 'c');
    const returning = [
      ProjectionItem.of('id', ColumnRef.of('c', 'id'), INTEGER),
      ProjectionItem.of('amount', ColumnRef.of('c', 'big'), BIGINT),
    ];

    it('returns an inserted 64-bit integer as decimal text', () => {
      const insert = InsertAst.into(target)
        .withRows([{ id: ParamRef.of(4), big: ParamRef.of(WIDE + 1n) }])
        .withReturning(returning);

      expect(run(insert)).toEqual([{ id: 4, amount: (WIDE + 1n).toString() }]);
    });

    it('returns an updated 64-bit integer as decimal text', () => {
      const update = UpdateAst.table(target)
        .withSet({ big: ParamRef.of(WIDE + 2n) })
        .withWhere(BinaryExpr.eq(ColumnRef.of('c', 'id'), ParamRef.of(1)))
        .withReturning(returning);

      expect(run(update)).toEqual([{ id: 1, amount: (WIDE + 2n).toString() }]);
    });

    it('returns a deleted 64-bit integer as decimal text', () => {
      const del = DeleteAst.from(target)
        .withWhere(BinaryExpr.eq(ColumnRef.of('c', 'id'), ParamRef.of(3)))
        .withReturning(returning);

      expect(run(del)).toEqual([{ id: 3, amount: WIDE.toString() }]);
    });
  });
});
