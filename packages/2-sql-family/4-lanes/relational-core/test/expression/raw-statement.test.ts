import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { type ParamRef, RawExpr, RawQueryAst, type RawSqlLiteral } from '../../src/exports/ast';
import { createRawSql, param } from '../../src/exports/expression';

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

describe('raw tag without a plan context', () => {
  it('produces expression builders only', () => {
    const expressionOnly = createRawSql(stubInferer);

    const builder = expressionOnly`now()`;

    expect(builder.returns('pg/timestamptz-temporal@1').buildAst()).toBeInstanceOf(RawExpr);
    expect('returnsRow' in builder).toBe(false);
    expect('affectedCount' in builder).toBe(false);
  });
});
