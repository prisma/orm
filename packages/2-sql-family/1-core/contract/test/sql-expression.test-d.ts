import { expectTypeOf, test } from 'vitest';
import { type SqlExpression, sql } from '../src/sql-expression';

test('sql returns a SqlExpression', () => {
  expectTypeOf(sql`now()`).not.toBeAny();
  expectTypeOf(sql`now()`).toEqualTypeOf<SqlExpression>();
});

test('sql interpolates other sql values', () => {
  const owner = sql`"userId" = auth.uid()`;
  expectTypeOf(sql`${owner} AND deleted_at IS NULL`).toEqualTypeOf<SqlExpression>();
});

test('a string or a number interpolated is a type error', () => {
  const text = 'x';
  // @ts-expect-error a string is not a sql value
  sql`a = ${text}`;
  // @ts-expect-error a number is not a sql value
  sql`a = ${1}`;
});

test('an object with a text is not a SqlExpression', () => {
  expectTypeOf({ text: 'x' }).not.toExtend<SqlExpression>();
  // @ts-expect-error the object lacks the marker a SqlExpression carries
  const value: SqlExpression = { text: 'x' };
  expectTypeOf(value).toEqualTypeOf<SqlExpression>();
});
