import { describe, expect, it } from 'vitest';
import { NativeJsonValueProjection } from '../../src/ast/json-value-projection';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  JsonArrayAggExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  WindowFuncExpr,
} from '../../src/ast/types';
import { collectOrderedParamRefs, compact, isAggregateProjection } from '../../src/ast/util';

describe('ast/util', () => {
  describe('compact', () => {
    it('removes undefined values', () => {
      const input = {
        a: 1,
        b: undefined,
        c: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: 2,
      });
      expect('b' in result).toBe(false);
    });

    it('removes null values', () => {
      const input = {
        a: 1,
        b: null,
        c: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: 2,
      });
      expect('b' in result).toBe(false);
    });

    it('removes empty arrays', () => {
      const input = {
        a: 1,
        b: [],
        c: [1, 2],
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        c: [1, 2],
      });
      expect('b' in result).toBe(false);
    });

    it('keeps non-empty arrays', () => {
      const input = {
        a: [1, 2, 3],
        b: [],
      };
      const result = compact(input);
      expect(result).toEqual({
        a: [1, 2, 3],
      });
    });

    it('removes multiple undefined and null values', () => {
      const input = {
        a: 1,
        b: undefined,
        c: null,
        d: 2,
        e: undefined,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        d: 2,
      });
    });

    it('removes undefined, null, and empty arrays together', () => {
      const input = {
        a: 1,
        b: undefined,
        c: null,
        d: [],
        e: 2,
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 1,
        e: 2,
      });
    });

    it('preserves all values when none are undefined, null, or empty arrays', () => {
      const input = {
        a: 1,
        b: 'test',
        c: [1, 2],
        d: { nested: true },
      };
      const result = compact(input);
      expect(result).toEqual(input);
    });

    it('handles empty object', () => {
      const input = {};
      const result = compact(input);
      expect(result).toEqual({});
    });

    it('handles object with only undefined values', () => {
      const input = {
        a: undefined,
        b: null,
        c: [],
      };
      const result = compact(input);
      expect(result).toEqual({});
    });

    it('preserves zero and false values', () => {
      const input = {
        a: 0,
        b: false,
        c: '',
      };
      const result = compact(input);
      expect(result).toEqual({
        a: 0,
        b: false,
        c: '',
      });
    });
  });

  describe('collectOrderedParamRefs', () => {
    function selectWithRefs(...where: Parameters<typeof AndExpr.of>[0]): SelectAst {
      return SelectAst.from(TableSource.named('user'))
        .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
        .withWhere(AndExpr.of(where));
    }

    it('returns refs in first-encounter (depth-first) order', () => {
      const a = ParamRef.of('a');
      const b = ParamRef.of('b');
      const c = ParamRef.of('c');
      const ast = selectWithRefs(
        BinaryExpr.eq(ColumnRef.of('user', 'a'), a),
        BinaryExpr.eq(ColumnRef.of('user', 'b'), b),
        BinaryExpr.eq(ColumnRef.of('user', 'c'), c),
      );

      expect(collectOrderedParamRefs(ast)).toEqual([a, b, c]);
    });

    it('dedupes by ParamRef identity (same instance referenced twice)', () => {
      const shared = ParamRef.of(1);
      const ast = selectWithRefs(
        BinaryExpr.eq(ColumnRef.of('user', 'a'), shared),
        BinaryExpr.eq(ColumnRef.of('user', 'b'), shared),
      );

      expect(collectOrderedParamRefs(ast)).toEqual([shared]);
    });

    it('keeps distinct ParamRef instances even when their values are equal', () => {
      const left = ParamRef.of(1);
      const right = ParamRef.of(1);
      const ast = selectWithRefs(
        BinaryExpr.eq(ColumnRef.of('user', 'a'), left),
        BinaryExpr.eq(ColumnRef.of('user', 'b'), right),
      );

      const refs = collectOrderedParamRefs(ast);
      expect(refs).toHaveLength(2);
      expect(refs[0]).toBe(left);
      expect(refs[1]).toBe(right);
    });

    it('returns an empty frozen array when the AST has no params', () => {
      const ast = SelectAst.from(TableSource.named('user')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ]);

      const refs = collectOrderedParamRefs(ast);
      expect(refs).toEqual([]);
      expect(Object.isFrozen(refs)).toBe(true);
    });
  });

  describe('isAggregateProjection', () => {
    const id = ColumnRef.of('users', 'id');

    it.each([
      { kind: 'aggregate', expr: AggregateExpr.count(id) },
      { kind: 'json-array-agg', expr: JsonArrayAggExpr.of(new NativeJsonValueProjection(id)) },
      { kind: 'window-func', expr: WindowFuncExpr.rowNumber({ orderBy: [OrderByItem.asc(id)] }) },
    ])('is true for a top-level $kind', ({ expr }) => {
      expect(isAggregateProjection(ProjectionItem.of('n', expr))).toBe(true);
    });

    it('is false for a column', () => {
      expect(isAggregateProjection(ProjectionItem.of('id', id))).toBe(false);
    });

    it('is false for an aggregate nested inside another expression', () => {
      const nested = BinaryExpr.gt(AggregateExpr.count(id), ParamRef.of(1));

      expect(isAggregateProjection(ProjectionItem.of('n', nested))).toBe(false);
    });
  });
});
