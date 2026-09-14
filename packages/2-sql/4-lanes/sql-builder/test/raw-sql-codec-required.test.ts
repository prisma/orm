import { isRuntimeError } from '@internal/framework-components/runtime';
import { ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { type Expression, toExpr } from '@internal/sql-relational-core/expression';
import { describe, expect, it } from 'vitest';

describe('raw SQL codec-required guard', () => {
  describe('toExpr throws RUNTIME.PARAM_REF_CODEC_REQUIRED for raw values without codec', () => {
    it('throws for a string value', () => {
      expect(() => toExpr('hello')).toThrow();
      try {
        toExpr('hello');
      } catch (e) {
        expect(isRuntimeError(e)).toBe(true);
        expect((e as { code: string }).code).toBe('RUNTIME.PARAM_REF_CODEC_REQUIRED');
      }
    });

    it('throws for a number value', () => {
      expect(() => toExpr(42)).toThrow();
      try {
        toExpr(42);
      } catch (e) {
        expect(isRuntimeError(e)).toBe(true);
        expect((e as { code: string }).code).toBe('RUNTIME.PARAM_REF_CODEC_REQUIRED');
      }
    });

    it('throws for null', () => {
      expect(() => toExpr(null)).toThrow();
    });

    it('throws for undefined', () => {
      expect(() => toExpr(undefined)).toThrow();
    });

    it('throws for a plain object', () => {
      expect(() => toExpr({ key: 'value' })).toThrow();
    });

    it('includes the JS type in the error message', () => {
      try {
        toExpr(42);
      } catch (e) {
        expect((e as Error).message).toMatch(/number/);
      }

      try {
        toExpr('hello');
      } catch (e) {
        expect((e as Error).message).toMatch(/string/);
      }
    });
  });

  describe('toExpr passes with explicit codec', () => {
    it('wraps a string value with codec as ParamRef', () => {
      const result = toExpr('hello', { codecId: 'pg/text@1' });
      expect(result).toBeInstanceOf(ParamRef);
      expect((result as ParamRef).codec).toEqual({ codecId: 'pg/text@1' });
    });

    it('wraps a number value with codec as ParamRef', () => {
      const result = toExpr(42, { codecId: 'pg/int4@1' });
      expect(result).toBeInstanceOf(ParamRef);
      expect((result as ParamRef).value).toBe(42);
    });

    it('wraps null with codec as ParamRef', () => {
      const result = toExpr(null, { codecId: 'pg/text@1' });
      expect(result).toBeInstanceOf(ParamRef);
      expect((result as ParamRef).value).toBeNull();
    });

    it('wraps a parameterized codec ref onto the ParamRef', () => {
      const codec = { codecId: 'pg/vector@1', typeParams: { length: 1536 } };
      const result = toExpr([1.0, 2.0, 3.0], codec);
      expect(result).toBeInstanceOf(ParamRef);
      expect((result as ParamRef).codec).toEqual(codec);
    });
  });

  describe('toExpr passes through Expression-like values regardless of codec', () => {
    it('unwraps an Expression without requiring codec', () => {
      const column = ColumnRef.of('users', 'email');
      const expression: Expression<{ codecId: 'pg/text@1'; nullable: false }> = {
        returnType: { codecId: 'pg/text@1', nullable: false },
        buildAst: () => column,
      };
      expect(toExpr(expression)).toBe(column);
    });
  });
});
