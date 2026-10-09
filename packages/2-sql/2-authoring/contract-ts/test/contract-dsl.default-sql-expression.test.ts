import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  autoincrement,
  field,
  model,
  now,
  type SqlExpression,
  sql,
} from '../src/exports/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { defineTestContract } from './helpers/define-test-contract';
import { unboundTables } from './unbound-tables';

const textColumn = columnDescriptor('sql/text@1');

function loweredDefault(builder: ReturnType<typeof field.column>) {
  const contract = defineTestContract({
    models: { T: model('T', { fields: { id: builder.id() } }) },
  });
  return unboundTables(contract.storage)['T']?.columns['id']?.default;
}

describe('.default() with a sql value', () => {
  it('lowers the text as a function default', () => {
    expect(loweredDefault(field.column(textColumn).default(sql`gen_random_uuid()`))).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('lowers the canonical text of a multi-line value', () => {
    expect(
      loweredDefault(
        field.column(textColumn).default(sql`
          (now()
            + '00:03:00'::interval)
        `),
      ),
    ).toEqual({ kind: 'function', expression: "(now()\n  + '00:03:00'::interval)" });
  });

  it('lowers the canonical text of a sql value another copy of the package made', () => {
    const fromAnotherCopy = blindCast<
      SqlExpression,
      "a sql value from another installed copy carries the marker but is not this copy's class"
    >({ [Symbol.for('@prisma/sql-expression')]: true, text: '\n    a\n      + b\n  ' });
    expect(loweredDefault(field.column(textColumn).default(fromAnotherCopy))).toEqual({
      kind: 'function',
      expression: 'a\n  + b',
    });
  });

  it.each([
    [
      'now',
      () => sql`now()`,
      'Write .default(now()) instead of sql`now()`; now() is a Prisma default function, not raw SQL.',
      'now()',
    ],
    [
      'autoincrement',
      () => sql` autoincrement() `,
      'Write .default(autoincrement()) instead of sql`autoincrement()`; autoincrement() is a Prisma default function, not raw SQL.',
      'autoincrement() ',
    ],
  ])('refuses sql`%s()` with CONTRACT.DEFAULT_INVALID', (_, value, message, expression) => {
    expect(() => field.column(textColumn).default(value())).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message,
        meta: { reason: 'reserved-function', expression },
      }),
    );
  });

  it('refuses a reserved text in .default(), not in the tag', () => {
    const value = sql`now()`;
    expect(value.text).toBe('now()');
    expect(() => field.column(textColumn).default(value)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.DEFAULT_INVALID' }),
    );
  });

  it('refuses unsafe SQL with CONTRACT.DEFAULT_INVALID', () => {
    expect(() => field.column(textColumn).default(sql`x; drop table t`)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
        meta: { reason: 'unsafe-sql', expression: 'x; drop table t' },
      }),
    );
  });

  it('passes NOW() and uuid() through as raw SQL', () => {
    expect([
      loweredDefault(field.column(textColumn).default(sql`NOW()`)),
      loweredDefault(field.column(textColumn).default(sql`uuid()`)),
    ]).toEqual([
      { kind: 'function', expression: 'NOW()' },
      { kind: 'function', expression: 'uuid()' },
    ]);
  });

  it('keeps accepting now(), autoincrement() and a function default object', () => {
    expect([
      loweredDefault(field.column(textColumn).default(now())),
      loweredDefault(field.column(textColumn).default(autoincrement())),
      loweredDefault(field.column(textColumn).default({ kind: 'function', expression: 'now()' })),
    ]).toEqual([
      { kind: 'function', expression: 'now()' },
      { kind: 'function', expression: 'autoincrement()' },
      { kind: 'function', expression: 'now()' },
    ]);
  });
});
