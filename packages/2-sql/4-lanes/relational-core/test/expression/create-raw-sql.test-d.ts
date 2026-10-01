import { assertType, test } from 'vitest';
import { ColumnRef, type ParamRef, type RawSqlLiteral } from '../../src/exports/ast';
import {
  buildOperation,
  createRawSql,
  type Expression,
  param,
  type RawSqlTag,
  type ScopeField,
} from '../../src/exports/expression';

// Minimal stub adapter — only the type matters here.
const stubAdapter = {
  inferCodec(_value: RawSqlLiteral): string {
    return 'test/str';
  },
};

const rawSql: RawSqlTag = createRawSql(stubAdapter);

// ── Positive: RawSqlLiteral members are accepted as interpolations ────────────

test('number literal typechecks as an interpolation', () => {
  const expr = rawSql`val = ${42}`.returns('pg/int4');
  assertType<Expression<ScopeField>>(expr);
});

test('bigint literal typechecks as an interpolation', () => {
  const expr = rawSql`val = ${9007199254740993n}`.returns('pg/int8');
  assertType<Expression<ScopeField>>(expr);
});

test('string literal typechecks as an interpolation', () => {
  const expr = rawSql`val = ${'hello'}`.returns('pg/text');
  assertType<Expression<ScopeField>>(expr);
});

test('boolean literal typechecks as an interpolation', () => {
  const expr = rawSql`flag = ${true}`.returns('pg/bool');
  assertType<Expression<ScopeField>>(expr);
});

test('Uint8Array typechecks as an interpolation', () => {
  const bytes = new Uint8Array([1, 2]);
  const expr = rawSql`data = ${bytes}`.returns('pg/bytea');
  assertType<Expression<ScopeField>>(expr);
});

// ── Positive: ParamRef from param() typechecks as an interpolation ────────────

test('ParamRef from param() typechecks as an interpolation', () => {
  const ref = param(42, { codecId: 'pg/int8' });
  assertType<ParamRef>(ref);
  const expr = rawSql`val = ${ref}`.returns('pg/text');
  assertType<Expression<ScopeField>>(expr);
});

// ── Positive: typed-builder Expression typechecks as an interpolation ─────────

test('Expression from buildOperation typechecks as an interpolation', () => {
  const inner = buildOperation({
    method: 'lower',
    args: [ColumnRef.of('t', 'name')],
    returns: { codecId: 'pg/text', nullable: false },
    lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
  });
  assertType<Expression<{ codecId: string; nullable: boolean }>>(inner);
  const outer = rawSql`result = ${inner}`.returns('pg/text');
  assertType<Expression<ScopeField>>(outer);
});

test('RawSqlTag expression result typechecks as an interpolation (nested factory)', () => {
  const inner = rawSql`now()`.returns('pg/timestamptz');
  assertType<Expression<ScopeField>>(inner);
  const outer = rawSql`created_at > ${inner}`.returns('pg/bool');
  assertType<Expression<ScopeField>>(outer);
});

// ── Negative: off-union values are rejected by the type system ────────────────

test('Date is rejected as an interpolation', () => {
  // @ts-expect-error — Date is not in RawSqlInterpolation; use param(date, { codecId })
  rawSql`${new Date()}`.returns('pg/timestamptz');
});

test('null is rejected as an interpolation', () => {
  // @ts-expect-error — null is not assignable to RawSqlInterpolation
  rawSql`${null}`.returns('pg/text');
});

test('undefined is rejected as an interpolation', () => {
  // @ts-expect-error — undefined is not assignable to RawSqlInterpolation
  rawSql`${undefined}`.returns('pg/text');
});

test('plain object is rejected as an interpolation', () => {
  // @ts-expect-error — plain object is not assignable to RawSqlInterpolation
  rawSql`${{ foo: 1 }}`.returns('pg/text');
});

test('array is rejected as an interpolation', () => {
  // @ts-expect-error — array is not assignable to RawSqlInterpolation
  rawSql`${[1, 2]}`.returns('pg/text');
});

test('custom class instance is rejected as an interpolation', () => {
  class MyClass {
    value = 1;
  }
  // @ts-expect-error — class instance is not assignable to RawSqlInterpolation
  rawSql`${new MyClass()}`.returns('pg/text');
});

// ── .returns() variants produce expected Expression types ────────────────────

test('.returns(string) preserves literal codecId and infers nullable: false', () => {
  const expr = rawSql`now()`.returns('pg/timestamptz');
  assertType<Expression<{ codecId: 'pg/timestamptz'; nullable: false }>>(expr);
});

test('.returns({ codecId }) preserves literal codecId and defaults nullable to false', () => {
  const expr = rawSql`now()`.returns({ codecId: 'pg/int4' });
  assertType<Expression<{ codecId: 'pg/int4'; nullable: false }>>(expr);
});

test('.returns({ codecId, nullable: true }) preserves literal codecId and literal nullable: true', () => {
  const expr = rawSql`now()`.returns({ codecId: 'pg/timestamptz', nullable: true });
  assertType<Expression<{ codecId: 'pg/timestamptz'; nullable: true }>>(expr);
});

// ── Multiple .returns() calls are structurally impossible ─────────────────────

test('calling .returns() twice is a type error — the returned Expression has no .returns()', () => {
  const expr = rawSql`now()`.returns('pg/timestamptz');
  // @ts-expect-error — Expression does not have a .returns() method
  expr.returns('pg/text');
});
