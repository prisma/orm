import { expectTypeOf, test } from 'vitest';
import type { IndexConstraint } from '../src/contract-dsl';
import * as contractBuilder from '../src/exports/contract-builder';
import { check, field, model, now, type SqlExpression, sql } from '../src/exports/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const textColumn = columnDescriptor('pg/text@1');
const fields = { id: field.column(textColumn).id(), email: field.column(textColumn) };

test('sql values compile in every raw-SQL field', () => {
  model('User', { fields }).sql(({ cols, constraints }) => ({
    indexes: [
      constraints.index([cols.email], { name: 'user_active', where: sql`archived_at IS NULL` }),
      constraints.index({ expression: sql`lower(email)`, name: 'user_lower_email' }),
    ],
    checks: [check({ expression: sql`char_length(email) > 0`, name: 'user_email_present' })],
  }));
  const index: IndexConstraint = { kind: 'index', fields: ['email'], where: sql`email <> ''` };
  expectTypeOf(index.where).toEqualTypeOf<SqlExpression | undefined>();
});

test('a string, a number and a boolean are type errors in index where', () => {
  model('User', { fields }).sql(({ cols, constraints }) => ({
    indexes: [
      // @ts-expect-error raw SQL is a sql value
      constraints.index([cols.email], { name: 'a', where: 'archived_at IS NULL' }),
      // @ts-expect-error raw SQL is a sql value
      constraints.index([cols.email], { name: 'b', where: 1 }),
      // @ts-expect-error raw SQL is a sql value
      constraints.index([cols.email], { name: 'c', where: true }),
    ],
  }));
});

test('a string, a number and a boolean are type errors in index expression', () => {
  model('User', { fields }).sql(({ constraints }) => ({
    indexes: [
      // @ts-expect-error raw SQL is a sql value
      constraints.index({ expression: 'lower(email)', name: 'a' }),
      // @ts-expect-error raw SQL is a sql value
      constraints.index({ expression: 1, name: 'b' }),
      // @ts-expect-error raw SQL is a sql value
      constraints.index({ expression: true, name: 'c' }),
    ],
  }));
});

test('a string, a number and a boolean are type errors in check expression', () => {
  // @ts-expect-error raw SQL is a sql value
  check({ expression: 'char_length(email) > 0', name: 'a' });
  // @ts-expect-error raw SQL is a sql value
  check({ expression: 1, name: 'b' });
  // @ts-expect-error raw SQL is a sql value
  check({ expression: true, name: 'c' });
});

test('a string, a number and a boolean are type errors in IndexConstraint.where', () => {
  model('User', { fields }).sql({
    indexes: [
      // @ts-expect-error raw SQL is a sql value
      { kind: 'index', fields: ['email'], where: 'archived_at IS NULL' },
      // @ts-expect-error raw SQL is a sql value
      { kind: 'index', fields: ['email'], where: 1 },
      // @ts-expect-error raw SQL is a sql value
      { kind: 'index', fields: ['email'], where: true },
    ],
  });
});

test('.default() takes a literal, a default function and a sql value', () => {
  field.column(textColumn).default('draft');
  field.column(textColumn).default(now());
  field.column(textColumn).default(sql`x`);
});

test('the builder entry exports sql and the SqlExpression type, not the class', () => {
  expectTypeOf(sql`x`).not.toBeAny();
  expectTypeOf(sql`x`).toEqualTypeOf<SqlExpression>();
  expectTypeOf(contractBuilder).not.toHaveProperty('SqlExpression');
});
