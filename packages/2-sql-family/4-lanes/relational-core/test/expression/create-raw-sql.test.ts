import { describe, expect, it } from 'vitest';
import { ColumnRef, ParamRef, RawExpr, type RawSqlLiteral } from '../../src/exports/ast';
import { buildOperation, createRawSql, param } from '../../src/exports/expression';

// Stub inferer used throughout — applies simple type-based codec resolution.
// Safe-integer integers → 'test/int'; fractions / out-of-safe-int numbers → 'test/float';
// bigint → 'test/bigint'; string → 'test/str'; boolean → 'test/bool'; Uint8Array → 'test/bytes'.
const stubInferer = {
  inferCodec(value: RawSqlLiteral): string {
    if (typeof value === 'bigint') return 'test/bigint';
    if (typeof value === 'string') return 'test/str';
    if (typeof value === 'boolean') return 'test/bool';
    if (value instanceof Uint8Array) return 'test/bytes';
    if (typeof value === 'number') {
      return Number.isFinite(value) && Number.isSafeInteger(value) ? 'test/int' : 'test/float';
    }
    throw new Error(`Unexpected value type: ${typeof value}`);
  },
};

const rawSql = createRawSql(stubInferer);

describe('createRawSql factory', () => {
  describe('zero-interpolation template', () => {
    it('produces a RawExpr with a single string part and the given returns codec', () => {
      const expr = rawSql`now()`.returns('pg/timestamptz');
      const ast = expr.buildAst();
      expect(ast).toBeInstanceOf(RawExpr);
      const rawExpr = ast as RawExpr;
      expect(rawExpr.parts).toEqual(['now()']);
      expect(rawExpr.returns).toEqual({ codecId: 'pg/timestamptz', nullable: false });
    });
  });

  describe('back-to-back interpolations', () => {
    it('preserves the empty string between consecutive interpolations in parts', () => {
      const a = param(1, { codecId: 'pg/int4' });
      const b = param(2, { codecId: 'pg/int4' });
      const expr = rawSql`${a}${b}`.returns('pg/text');
      const rawExpr = expr.buildAst() as RawExpr;
      expect(rawExpr.parts).toHaveLength(5);
      expect(rawExpr.parts[0]).toBe('');
      expect(rawExpr.parts[1]).toBe(a);
      expect(rawExpr.parts[2]).toBe('');
      expect(rawExpr.parts[3]).toBe(b);
      expect(rawExpr.parts[4]).toBe('');
    });
  });

  describe('bare RawSqlLiteral interpolation routes through inferer.inferCodec', () => {
    it('wraps a number (safe integer) as a ParamRef with codec from inferer', () => {
      const expr = rawSql`${42}`.returns('test/int');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBeInstanceOf(ParamRef);
      expect((part as ParamRef).value).toBe(42);
      expect((part as ParamRef).codec?.codecId).toBe('test/int');
    });

    it('wraps a bigint as a ParamRef with codec from inferer', () => {
      const expr = rawSql`${9007199254740993n}`.returns('test/bigint');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBeInstanceOf(ParamRef);
      expect((part as ParamRef).value).toBe(9007199254740993n);
      expect((part as ParamRef).codec?.codecId).toBe('test/bigint');
    });

    it('wraps a string as a ParamRef with codec from inferer', () => {
      const expr = rawSql`${'hello'}`.returns('test/str');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBeInstanceOf(ParamRef);
      expect((part as ParamRef).value).toBe('hello');
      expect((part as ParamRef).codec?.codecId).toBe('test/str');
    });

    it('wraps a boolean as a ParamRef with codec from inferer', () => {
      const expr = rawSql`${true}`.returns('test/bool');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBeInstanceOf(ParamRef);
      expect((part as ParamRef).value).toBe(true);
      expect((part as ParamRef).codec?.codecId).toBe('test/bool');
    });

    it('wraps a Uint8Array as a ParamRef with codec from inferer', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const expr = rawSql`${bytes}`.returns('test/bytes');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBeInstanceOf(ParamRef);
      expect((part as ParamRef).value).toBe(bytes);
      expect((part as ParamRef).codec?.codecId).toBe('test/bytes');
    });
  });

  describe('ParamRef interpolation passes through unchanged', () => {
    it('preserves the exact ParamRef instance and its codec', () => {
      const ref = param(42, { codecId: 'pg/int8' });
      const expr = rawSql`val = ${ref}`.returns('pg/text');
      const rawExpr = expr.buildAst() as RawExpr;
      const part = rawExpr.parts[1];
      expect(part).toBe(ref);
      expect((part as ParamRef).codec?.codecId).toBe('pg/int8');
    });
  });

  describe('Expression interpolation unwraps via buildAst()', () => {
    it('unwraps a typed Expression into its underlying AST node', () => {
      const innerExpr = buildOperation({
        method: 'lower',
        args: [ColumnRef.of('t', 'name')],
        returns: { codecId: 'pg/text', nullable: false },
        lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
      });
      const expr = rawSql`prefix_${innerExpr}_suffix`.returns('pg/text');
      const rawExpr = expr.buildAst() as RawExpr;
      expect(rawExpr.parts).toHaveLength(3);
      expect(rawExpr.parts[0]).toBe('prefix_');
      expect(rawExpr.parts[1]).toBe(innerExpr.buildAst());
      expect(rawExpr.parts[2]).toBe('_suffix');
    });
  });

  describe('number boundary cases routed through inferer', () => {
    it('routes a safe integer to test/int via stub inferer', () => {
      const expr = rawSql`${42}`.returns('test/int');
      const rawExpr = expr.buildAst() as RawExpr;
      expect((rawExpr.parts[1] as ParamRef).codec?.codecId).toBe('test/int');
    });

    it('routes a fractional number to test/float via stub inferer', () => {
      const expr = rawSql`${1.5}`.returns('test/float');
      const rawExpr = expr.buildAst() as RawExpr;
      expect((rawExpr.parts[1] as ParamRef).codec?.codecId).toBe('test/float');
    });

    it('routes a number beyond safe-integer range to test/float via stub inferer', () => {
      const beyondSafe = Number.MAX_SAFE_INTEGER + 1;
      const expr = rawSql`${beyondSafe}`.returns('test/float');
      const rawExpr = expr.buildAst() as RawExpr;
      expect((rawExpr.parts[1] as ParamRef).codec?.codecId).toBe('test/float');
    });

    it('routes -0 to test/int via stub inferer (isSafeInteger(-0) is true)', () => {
      const expr = rawSql`${-0}`.returns('test/int');
      const rawExpr = expr.buildAst() as RawExpr;
      expect((rawExpr.parts[1] as ParamRef).codec?.codecId).toBe('test/int');
    });
  });

  describe('param() override produces different codec than bare literal', () => {
    it('bare 42 uses inferer-inferred codec while param(42, { codecId }) uses the specified one', () => {
      const withBare = rawSql`${42}`.returns('test/int').buildAst() as RawExpr;
      const withParam = rawSql`${param(42, { codecId: 'pg/int8' })}`
        .returns('test/int')
        .buildAst() as RawExpr;
      expect((withBare.parts[1] as ParamRef).codec?.codecId).toBe('test/int');
      expect((withParam.parts[1] as ParamRef).codec?.codecId).toBe('pg/int8');
    });
  });

  describe('.returns() normalization', () => {
    it('string codec produces nullable: false on returnType', () => {
      const expr = rawSql`now()`.returns('pg/timestamptz');
      expect(expr.returnType).toEqual({ codecId: 'pg/timestamptz', nullable: false });
    });

    it('object codec with no nullable produces nullable: false on returnType', () => {
      const expr = rawSql`now()`.returns({ codecId: 'pg/timestamptz' });
      expect(expr.returnType).toEqual({ codecId: 'pg/timestamptz', nullable: false });
    });

    it('string and object forms with the same codecId produce identical returnType', () => {
      const fromString = rawSql`now()`.returns('pg/timestamptz');
      const fromObject = rawSql`now()`.returns({ codecId: 'pg/timestamptz' });
      expect(fromString.returnType).toEqual(fromObject.returnType);
    });

    it('object with nullable: true persists nullable: true on returnType', () => {
      const expr = rawSql`now()`.returns({ codecId: 'pg/timestamptz', nullable: true });
      expect(expr.returnType).toEqual({ codecId: 'pg/timestamptz', nullable: true });
    });

    it('returnType matches the RawExpr.returns field', () => {
      const expr = rawSql`now()`.returns({ codecId: 'pg/text', nullable: true });
      const rawExpr = expr.buildAst() as RawExpr;
      expect(rawExpr.returns).toEqual(expr.returnType);
    });
  });

  describe('nested RawExpr interpolated into another factory call', () => {
    it('unwraps the inner Expression and places its RawExpr AST node in parts', () => {
      const inner = rawSql`now()`.returns('pg/timestamptz');
      const outer = rawSql`created_at > ${inner}`.returns('pg/bool');
      const outerAst = outer.buildAst() as RawExpr;
      expect(outerAst.parts).toHaveLength(3);
      expect(outerAst.parts[1]).toBeInstanceOf(RawExpr);
      expect(outerAst.parts[1]).toBe(inner.buildAst());
    });
  });

  describe('runtime throw when interpolating an off-union value via type cast', () => {
    type AnyTemplate = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => { returns(spec: string): { buildAst(): unknown } };
    const offUnion = rawSql as unknown as AnyTemplate;
    const verbatimMsg = 'wrap this value in `param(...)` with an explicit codec';

    it('throws with the spec verbatim phrase when a Date is passed via any cast', () => {
      expect(() => {
        const tagged = offUnion`${new Date()}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });

    it('throws with the spec verbatim phrase when null is passed via any cast', () => {
      expect(() => {
        const tagged = offUnion`${null}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });

    it('throws with the spec verbatim phrase when a plain object is passed via any cast', () => {
      expect(() => {
        const tagged = offUnion`${{ x: 1 }}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });

    it('throws with the spec verbatim phrase when an array is passed via any cast', () => {
      expect(() => {
        const tagged = offUnion`${[1, 2]}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });

    it('throws with the spec verbatim phrase when a class instance is passed via any cast', () => {
      class Custom {}
      expect(() => {
        const tagged = offUnion`${new Custom()}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });

    it('throws with the spec verbatim phrase when undefined is passed via any cast', () => {
      expect(() => {
        const tagged = offUnion`${undefined}`;
        tagged.returns('pg/text');
      }).toThrow(verbatimMsg);
    });
  });
});
