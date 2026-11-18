import { describe, expect, it } from 'vitest';
import { checkSqlDefaultText, reservedSqlDefaultText } from '../src/default-sql-text';

describe('reservedSqlDefaultText', () => {
  it.each([
    ['now()', 'now'],
    [' now() ', 'now'],
    ['autoincrement()', 'autoincrement'],
    ['\n  autoincrement()\n', 'autoincrement'],
  ] as const)('names the Prisma default function %j is', (text, name) => {
    expect(reservedSqlDefaultText(text)).toBe(name);
  });

  it.each([
    ['NOW()'],
    ['now ()'],
    ['gen_random_uuid()'],
    ['uuid()'],
    ["now() + interval '1 day'"],
    ['CURRENT_TIMESTAMP'],
    [''],
  ])('passes %j as raw SQL', (text) => {
    expect(reservedSqlDefaultText(text)).toBeUndefined();
  });
});

describe('checkSqlDefaultText', () => {
  it.each([
    ['gen_random_uuid()'],
    ["(now() + '00:03:00'::interval)"],
    ["'{}'::text[]"],
    ['CURRENT_TIMESTAMP'],
    ['selected_at'],
    [''],
  ])('accepts %j', (text) => {
    expect(checkSqlDefaultText(text)).toBeUndefined();
  });

  it.each([
    ['a semicolon', "eek(); DROP TABLE 'x'"],
    ['a line comment', 'now() -- x'],
    ['a block comment', 'now() /* x */'],
    ['dollar quoting', '$$x$$'],
    ['a subquery', '(select 1)'],
    ['an upper-case subquery', '(SELECT 1)'],
    ['the word select inside a SQL string literal', "'no select here'"],
  ])('rejects %s', (_name, text) => {
    expect(checkSqlDefaultText(text)).toBe(
      'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
    );
  });
});
