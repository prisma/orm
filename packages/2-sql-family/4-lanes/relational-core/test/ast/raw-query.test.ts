import { describe, expect, it } from 'vitest';
import { BinaryExpr, isQueryAst, queryAstKinds, RawQueryAst } from '../../src/exports/ast';
import { col, param, shiftParamRef } from './test-helpers';

const columns = {
  id: { codecId: 'pg/int4@1', nullable: false },
  email: { codecId: 'pg/text@1', nullable: true },
} as const;

describe('ast/RawQueryAst', () => {
  describe('row-returning node', () => {
    it('carries the raw-query kind and the declared columns', () => {
      const node = RawQueryAst.rows(['select id, email from "user"'], columns);

      expect(node.kind).toBe('raw-query');
      expect(node.result).toEqual({ kind: 'rows', columns });
    });

    it('is admitted to the query-AST alphabet', () => {
      const node = RawQueryAst.rows(['select 1'], {
        one: { codecId: 'pg/int4@1', nullable: false },
      });

      expect(queryAstKinds.has('raw-query')).toBe(true);
      expect(isQueryAst(node)).toBe(true);
    });

    it('freezes the parts array so mutation attempts throw', () => {
      const node = RawQueryAst.rows(['select 1'], columns);

      expect(() => {
        (node.parts as string[]).push('extra');
      }).toThrow(TypeError);
    });

    it('freezes the declared columns so mutation attempts throw', () => {
      const node = RawQueryAst.rows(['select 1'], columns);
      const result = node.result;
      if (result.kind !== 'rows') throw new Error('expected a row-returning result');

      expect(() => {
        (result.columns as Record<string, { codecId: string; nullable: boolean }>)['extra'] = {
          codecId: 'pg/text@1',
          nullable: false,
        };
      }).toThrow(TypeError);
      expect(() => {
        (result.columns['id'] as { nullable: boolean }).nullable = true;
      }).toThrow(TypeError);
    });

    it('copies the parts array so later caller mutation does not leak in', () => {
      const parts: Array<string> = ['select 1'];
      const node = RawQueryAst.rows(parts, columns);
      parts.push('; drop table "user"');

      expect(node.parts).toEqual(['select 1']);
    });
  });

  describe('column names that collide with object machinery', () => {
    const protoColumns = Object.fromEntries([
      ['__proto__', { codecId: 'pg/int4@1', nullable: false }],
    ]) as Record<string, { codecId: string; nullable: boolean }>;

    it('refuses a __proto__ column instead of dropping it', () => {
      expect(() => RawQueryAst.rows(['select 1 as "__proto__"'], protoColumns)).toThrow(
        /__proto__/,
      );
    });

    it('names the offending column in the structured error', () => {
      expect(() => RawQueryAst.rows(['select 1 as "__proto__"'], protoColumns)).toThrow(
        expect.objectContaining({
          code: 'RUNTIME.AST_INVALID',
          meta: expect.objectContaining({ column: '__proto__' }),
        }),
      );
    });

    it('keeps a constructor column as an own property of the frozen record', () => {
      const node = RawQueryAst.rows(['select 1 as "constructor"'], {
        constructor: { codecId: 'pg/int4@1', nullable: false },
        id: { codecId: 'pg/int4@1', nullable: false },
      });
      const result = node.result;
      if (result.kind !== 'rows') throw new Error('expected a row-returning result');

      expect(Object.keys(result.columns)).toEqual(['constructor', 'id']);
      expect(result.columns['constructor']).toEqual({ codecId: 'pg/int4@1', nullable: false });
    });

    it('leaves the frozen column record on the ordinary object prototype', () => {
      const node = RawQueryAst.rows(['select 1'], columns);
      const result = node.result;
      if (result.kind !== 'rows') throw new Error('expected a row-returning result');

      expect(Object.getPrototypeOf(result.columns)).toBe(Object.prototype);
    });
  });

  describe('affected-count node', () => {
    it('carries the affected-count result marker and no columns', () => {
      const node = RawQueryAst.affectedCount(['update "user" set seen = now()']);

      expect(node.kind).toBe('raw-query');
      expect(node.result).toEqual({ kind: 'affected-count' });
    });
  });

  describe('param collection', () => {
    it('collects param refs from parts in template order', () => {
      const first = param(1, 'a');
      const second = param(2, 'b');
      const node = RawQueryAst.rows(
        ['select id from "user" where a = ', first, ' and b = ', second],
        columns,
      );

      expect(node.collectParamRefs()).toEqual([first, second]);
    });

    it('collects param refs nested inside interpolated expressions', () => {
      const nested = param(7, 'n');
      const node = RawQueryAst.affectedCount([
        'delete from "user" where id = ',
        BinaryExpr.eq(col('user', 'id'), nested),
      ]);

      expect(node.collectParamRefs()).toEqual([nested]);
    });

    it('reports no params for a template made only of strings', () => {
      expect(RawQueryAst.rows(['select 1'], columns).collectParamRefs()).toEqual([]);
    });
  });

  describe('rewrite', () => {
    it('rewrites expression parts and leaves string parts untouched', () => {
      const node = RawQueryAst.rows(['select id from "user" where a = ', param(1, 'a')], columns);

      const rewritten = node.rewrite({ paramRef: shiftParamRef(10) });

      expect(rewritten).toBeInstanceOf(RawQueryAst);
      expect(rewritten.parts[0]).toBe('select id from "user" where a = ');
      expect(rewritten.collectParamRefs()[0]?.kind).toBe('param-ref');
      expect(node.collectParamRefs()[0]).toEqual(expect.objectContaining({ value: 1 }));
      expect(rewritten.collectParamRefs()[0]).toEqual(expect.objectContaining({ value: 11 }));
    });

    it('preserves the result declaration across a rewrite', () => {
      const node = RawQueryAst.rows(['select id from "user" where a = ', param(1, 'a')], columns);

      expect(node.rewrite({ paramRef: shiftParamRef(1) }).result).toEqual({
        kind: 'rows',
        columns,
      });
      expect(
        RawQueryAst.affectedCount(['delete from "user" where a = ', param(1, 'a')]).rewrite({
          paramRef: shiftParamRef(1),
        }).result,
      ).toEqual({ kind: 'affected-count' });
    });
  });

  it('returns itself from toQueryAst', () => {
    const node = RawQueryAst.rows(['select 1'], columns);

    expect(node.toQueryAst()).toBe(node);
  });
});
