import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  type ParamRef,
  ProjectionItem,
  RawExpr,
  RawQueryAst,
  type RawSqlLiteral,
  SelectAst,
  TableSource,
  UpdateAst,
} from '../../src/exports/ast';
import {
  createRawSql,
  param,
  type RowReturningStatement,
  type ScopeField,
} from '../../src/exports/expression';
import type { Subquery } from '../../src/exports/functions';

const CONTRACT = {
  target: 'postgres',
  targetFamily: 'sql',
  storage: { storageHash: 'test-storage' },
} as unknown as Contract<SqlStorage>;

const stubInferer = {
  inferCodec(value: RawSqlLiteral): string {
    if (typeof value === 'number') return 'test/int';
    return 'test/str';
  },
};

const rawSql = createRawSql(stubInferer, { contract: CONTRACT });

function selectUserIds(where: ParamRef): SelectAst {
  return SelectAst.from(TableSource.named('user'))
    .addProjection('id', ColumnRef.of('user', 'id'))
    .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'invited_by_id'), where));
}

function builderQuery(ast: SelectAst): Subquery<Record<string, ScopeField>> {
  return {
    buildAst: () => ast,
    build: () => ({ ast }),
    getRowFields: () => ({ id: { codecId: 'pg/int4@1', nullable: false } }),
  } as unknown as Subquery<Record<string, ScopeField>>;
}

describe('raw statement terminators', () => {
  describe('.returnsRow()', () => {
    it('mints a plan whose AST is a row-returning raw-query node', () => {
      const plan = rawSql`select id, email from "user"`
        .returnsRow({ id: 'pg/int4@1', email: { codecId: 'pg/text@1', nullable: true } })
        .build();

      expect(plan.ast).toBeInstanceOf(RawQueryAst);
      expect(plan.ast.kind).toBe('raw-query');
      expect((plan.ast as RawQueryAst).result).toEqual({
        kind: 'rows',
        columns: {
          id: { codecId: 'pg/int4@1', nullable: false },
          email: { codecId: 'pg/text@1', nullable: true },
        },
      });
    });

    it('sources plan meta from the contract and defaults the lane to raw', () => {
      const plan = rawSql`select 1 as one`.returnsRow({ one: 'pg/int4@1' }).build();

      expect(plan.meta).toEqual({
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test-storage',
        lane: 'raw',
      });
      expect(plan.params).toEqual([]);
    });

    it('honours a lane id supplied with the plan context', () => {
      const tagged = createRawSql(stubInferer, { contract: CONTRACT, laneId: 'raw:whole-query' });

      const plan = tagged`select 1 as one`.returnsRow({ one: 'pg/int4@1' }).build();

      expect(plan.meta.lane).toBe('raw:whole-query');
    });

    it('carries interpolated params into the node in template order', () => {
      const since = param('2026-01-01', { codecId: 'pg/timestamptz-string@1' });
      const plan = rawSql`select id from "user" where created_at > ${since} and id > ${7}`
        .returnsRow({ id: 'pg/int4@1' })
        .build();

      const node = plan.ast as RawQueryAst;
      expect(node.parts[1]).toBe(since);
      expect(node.collectParamRefs().map((ref) => (ref as ParamRef).value)).toEqual([
        '2026-01-01',
        7,
      ]);
    });
  });

  describe('.affectedCount()', () => {
    it('mints a plan whose AST carries the affected-count result marker', () => {
      const plan = rawSql`update "user" set last_seen = now() where id = ${3}`
        .affectedCount()
        .build();

      expect(plan.ast).toBeInstanceOf(RawQueryAst);
      expect((plan.ast as RawQueryAst).result).toEqual({ kind: 'affected-count' });
      expect(plan.meta.lane).toBe('raw');
    });
  });

  describe('row-spec column names that collide with object machinery', () => {
    it('refuses a computed __proto__ key rather than losing it in normalization', () => {
      const spec: Record<string, string> = Object.fromEntries([['__proto__', 'pg/int4@1']]);

      expect(() => rawSql`select 1 as "__proto__"`.returnsRow(spec)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.AST_INVALID',
          meta: expect.objectContaining({ column: '__proto__' }),
        }),
      );
    });

    it('normalizes a constructor column like any other', () => {
      const plan = rawSql`select 1 as "constructor"`
        .returnsRow({ constructor: 'pg/int4@1' })
        .build();

      expect((plan.ast as RawQueryAst).result).toEqual({
        kind: 'rows',
        columns: { constructor: { codecId: 'pg/int4@1', nullable: false } },
      });
    });
  });

  describe('expression terminator alongside the statement terminators', () => {
    it('still produces a RawExpr from .returns()', () => {
      const expr = rawSql`now()`.returns('pg/timestamptz-temporal@1');

      expect(expr.buildAst()).toBeInstanceOf(RawExpr);
      expect(expr.returnType).toEqual({ codecId: 'pg/timestamptz-temporal@1', nullable: false });
    });
  });

  describe('composition: a row-returning raw query as a template interpolation', () => {
    it('splices the inner parts into the outer template instead of nesting a node', () => {
      const active = rawSql`select id from "user" where last_seen > ${'2026-01-01'}`.returnsRow({
        id: 'pg/int4@1',
      });

      const plan =
        rawSql`with active as (${active}) select count(*) as n from active where id > ${5}`
          .returnsRow({ n: 'pg/int8@1' })
          .build();

      const node = plan.ast as RawQueryAst;
      expect(node.parts.some((part) => part instanceof RawQueryAst)).toBe(false);
      expect(node.parts.filter((part) => typeof part === 'string')).toEqual([
        'with active as (',
        'select id from "user" where last_seen > ',
        '',
        ') select count(*) as n from active where id > ',
        '',
      ]);
    });

    it('preserves param order across the splice', () => {
      const active = rawSql`select id from "user" where last_seen > ${'2026-01-01'}`.returnsRow({
        id: 'pg/int4@1',
      });

      const plan =
        rawSql`with active as (${active}) select count(*) as n from active where id > ${5}`
          .returnsRow({ n: 'pg/int8@1' })
          .build();

      expect(
        (plan.ast as RawQueryAst).collectParamRefs().map((ref) => (ref as ParamRef).value),
      ).toEqual(['2026-01-01', 5]);
    });

    it('drops the inner row declaration — the outer template declares its own', () => {
      const active = rawSql`select id from "user"`.returnsRow({ id: 'pg/int4@1' });

      const plan = rawSql`select n from (${active}) t`.returnsRow({ n: 'pg/int8@1' }).build();

      expect((plan.ast as RawQueryAst).result).toEqual({
        kind: 'rows',
        columns: { n: { codecId: 'pg/int8@1', nullable: false } },
      });
    });

    it('interpolates into an expression-position template as well', () => {
      const active = rawSql`select 1`.returnsRow({ one: 'pg/int4@1' });

      const expr = rawSql`exists (${active})`.returns('pg/bool@1');

      const node = expr.buildAst() as RawExpr;
      expect(node.parts).toEqual(['exists (', 'select 1', ')']);
    });
  });
});

describe('composition: a builder query as a template interpolation', () => {
  it('carries the query select AST as one part at the interpolation point', () => {
    const select = selectUserIds(param(1, { codecId: 'pg/int4@1' }));

    const plan = rawSql`insert into archive (id) ${builderQuery(select)} returning id`
      .returnsRow({ id: 'pg/int4@1' })
      .build();

    expect((plan.ast as RawQueryAst).parts).toEqual([
      'insert into archive (id) ',
      select,
      ' returning id',
    ]);
    expect((plan.ast as RawQueryAst).parts[1]).toBe(select);
  });

  it('orders params before, inside and after the embedded query as written', () => {
    const query = builderQuery(selectUserIds(param('inside', { codecId: 'test/str' })));

    const plan =
      rawSql`with x as (select ${'before'}) insert into archive (id) ${query} where id > ${7}`
        .returnsRow({ id: 'pg/int4@1' })
        .build();

    expect(
      (plan.ast as RawQueryAst).collectParamRefs().map((ref) => (ref as ParamRef).value),
    ).toEqual(['before', 'inside', 7]);
  });

  it('accepts a builder query that also exposes build() without reading parts off it', () => {
    const query = builderQuery(selectUserIds(param(1, { codecId: 'pg/int4@1' })));

    expect(() => rawSql`insert into archive (id) ${query}`.affectedCount().build()).not.toThrow();
  });

  it('still splices a row-returning raw query when a builder query sits next to it', () => {
    const active = rawSql`select id from "user" where last_seen > ${'2026-01-01'}`.returnsRow({
      id: 'pg/int4@1',
    });
    const select = selectUserIds(param(2, { codecId: 'pg/int4@1' }));

    const plan = rawSql`with active as (${active}) ${builderQuery(select)}`
      .returnsRow({ id: 'pg/int4@1' })
      .build();

    const node = plan.ast as RawQueryAst;
    expect(node.parts.some((part) => part instanceof RawQueryAst)).toBe(false);
    expect(node.parts.filter((part) => part instanceof SelectAst)).toEqual([select]);
    expect(node.collectParamRefs().map((ref) => (ref as ParamRef).value)).toEqual([
      '2026-01-01',
      2,
    ]);
  });

  it('carries the select AST into an expression-position template', () => {
    const select = selectUserIds(param(1, { codecId: 'pg/int4@1' }));

    const expr = rawSql`exists (${builderQuery(select)})`.returns('pg/bool@1');

    expect((expr.buildAst() as RawExpr).parts).toEqual(['exists (', select, ')']);
  });
});

describe('composition: a row-returning builder mutation as a template interpolation', () => {
  function insertReturningId(value: ParamRef): InsertAst {
    return InsertAst.into(TableSource.named('user'))
      .withRows([{ email: value }])
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
  }

  function builderMutation(ast: InsertAst): RowReturningStatement<Record<string, ScopeField>> {
    return {
      buildAst: () => ast,
      build: () => ({ ast }),
    } as unknown as RowReturningStatement<Record<string, ScopeField>>;
  }

  it('carries the mutation AST as one part with its params in template order', () => {
    const insert = insertReturningId(param('inside', { codecId: 'test/str' }));

    const plan =
      rawSql`with inserted as (${builderMutation(insert)}) select id from inserted where id > ${7}`
        .returnsRow({ id: 'pg/int4@1' })
        .build();

    const node = plan.ast as RawQueryAst;
    expect(node.parts).toEqual([
      'with inserted as (',
      insert,
      ') select id from inserted where id > ',
      expect.any(Object),
      '',
    ]);
    expect(node.collectParamRefs().map((ref) => (ref as ParamRef).value)).toEqual(['inside', 7]);
  });
});

describe('a builder mutation without RETURNING as a template interpolation', () => {
  function builderMutation(
    ast: InsertAst | UpdateAst | DeleteAst,
  ): RowReturningStatement<Record<string, ScopeField>> {
    return { buildAst: () => ast } as unknown as RowReturningStatement<Record<string, ScopeField>>;
  }

  const user = TableSource.named('user');
  const byId = BinaryExpr.eq(ColumnRef.of('user', 'id'), param(1, { codecId: 'pg/int4@1' }));

  it.each([
    ['insert', InsertAst.into(user).withRows([{ email: param('a', { codecId: 'test/str' }) }])],
    ['update', UpdateAst.table(user).withSet({ email: param('a', { codecId: 'test/str' }) })],
    ['delete', DeleteAst.from(user).withWhere(byId)],
    [
      'insert with an empty returning list',
      InsertAst.into(user)
        .withRows([{ email: param('a', { codecId: 'test/str' }) }])
        .withReturning([]),
    ],
  ] as const)('refuses an embedded %s', (_name, ast) => {
    expect(() => rawSql`with x as (${builderMutation(ast)}) select 1`).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION',
        message: expect.stringContaining('.returning('),
      }),
    );
  });
});

describe('raw tag without a plan context', () => {
  it('produces expression builders only', () => {
    const expressionOnly = createRawSql(stubInferer);

    const builder = expressionOnly`now()`;

    expect(builder.returns('pg/timestamptz-temporal@1').buildAst()).toBeInstanceOf(RawExpr);
    expect('returnsRow' in builder).toBe(false);
    expect('affectedCount' in builder).toBe(false);
  });
});
