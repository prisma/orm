import {
  isDataTypeLoweringEntry,
  loweringEntryKey,
} from '@internal/framework-components/authoring';
import { checkSqlDefaultBody } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { fixtureDataTypeEntries } from '../../2-authoring/contract-psl/test/fixture-data-types';
import { sqlDefaultLiteralTagEntry } from '../src/core/sql-default-literal-tag';

const span = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 5, line: 1, column: 6 },
} as const;
const context = { sourceId: 'schema.prisma', modelName: 'T', fieldName: 'id' } as const;
const REJECTION =
  'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.';

describe('checkSqlDefaultBody', () => {
  it.each([
    ['gen_random_uuid()'],
    ["(now() + '00:03:00'::interval)"],
    ["'{}'::text[]"],
    ['CURRENT_TIMESTAMP'],
    ['selected_at'],
    [''],
  ])('accepts %j', (body) => {
    expect(checkSqlDefaultBody(body)).toBeUndefined();
  });

  it.each([
    ['a semicolon', "eek(); DROP TABLE 'x'"],
    ['a line comment', 'now() -- x'],
    ['a block comment', 'now() /* x */'],
    ['dollar quoting', '$$x$$'],
    ['a subquery', '(select 1)'],
    ['an upper-case subquery', '(SELECT 1)'],
    ['the word select inside a SQL string literal', "'no select here'"],
  ])('rejects %s', (_name, body) => {
    expect(checkSqlDefaultBody(body)).toBe(REJECTION);
  });
});

describe('sqlDefaultLiteralTagEntry', () => {
  const registeredEntry = sqlDefaultLiteralTagEntry('pg.sql');
  if (!isDataTypeLoweringEntry(registeredEntry)) throw new Error('a lowering entry');
  const entry = registeredEntry;

  it('names the tag it is written with, and what it does', () => {
    expect(entry.written).toEqual({ kind: 'tag', tag: 'pg.sql' });
    expect(entry.documentation).toBe(
      "Uses the SQL in the string, verbatim, as the column's default expression.",
    );
  });

  it('lowers the body verbatim as a function default', () => {
    const body = "(now() + '00:03:00'::interval)";
    expect(entry.lower({ literal: { tag: 'pg.sql', body, span }, context })).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: body } },
    });
  });

  it('lowers an empty body without a diagnostic', () => {
    expect(entry.lower({ literal: { tag: 'sql', body: '', span }, context })).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: '' } },
    });
  });

  it.each([
    ['sql', 'now'],
    ['sql', 'autoincrement'],
    ['pg.sql', 'now'],
    ['sqlite.sql', 'autoincrement'],
  ])('refuses %s`%s()`, naming the tag the author wrote', (tag, name) => {
    expect(entry.lower({ literal: { tag, body: ` ${name}() `, span }, context })).toEqual({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: `Write @default(${name}()) instead of ${tag}\`${name}()\`; ${name}() is a Prisma default function, not raw SQL.`,
        sourceId: 'schema.prisma',
        span,
      },
    });
  });

  it.each([['NOW()'], ['gen_random_uuid()'], ['uuid()']])(
    'lowers %s verbatim: only the exact texts now() and autoincrement() are reserved',
    (body) => {
      expect(entry.lower({ literal: { tag: 'sql', body, span }, context })).toEqual({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'function', expression: body } },
      });
    },
  );

  it('accepts a body that uses now() inside a larger expression', () => {
    expect(
      entry.lower({
        literal: { tag: 'sql', body: "now() + interval '1 day'", span },
        context,
      }),
    ).toMatchObject({ ok: true });
  });

  it('accepts a bare call to a database function', () => {
    expect(entry.lower({ literal: { tag: 'sql', body: 'random()', span }, context })).toMatchObject(
      { ok: true },
    );
  });

  it('reports a rejected body as PSL_INVALID_DEFAULT_SQL at the literal', () => {
    expect(entry.lower({ literal: { tag: 'sql', body: 'x; y', span }, context })).toEqual({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: REJECTION,
        sourceId: 'schema.prisma',
        span,
      },
    });
  });
});

describe('the contract-psl fixture entries mirror the family entry', () => {
  const registered = fixtureDataTypeEntries[loweringEntryKey('sql')];
  if (registered === undefined || !isDataTypeLoweringEntry(registered)) {
    throw new Error('the fixture entries do not register `sql` as a lowering tag');
  }
  const fixtureEntry = registered;
  const registeredFamilyEntry = sqlDefaultLiteralTagEntry('sql');
  if (!isDataTypeLoweringEntry(registeredFamilyEntry)) throw new Error('a lowering entry');
  const familyEntry = registeredFamilyEntry;

  it.each([
    ['x; y'],
    ['now()'],
    ['autoincrement()'],
    ['gen_random_uuid()'],
    ['random()'],
    ["'no select here'"],
    [''],
  ])('lowers %j the same way', (body) => {
    expect(fixtureEntry.lower({ literal: { tag: 'sql', body, span }, context })).toEqual(
      familyEntry.lower({ literal: { tag: 'sql', body, span }, context }),
    );
  });
});
