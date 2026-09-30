import { describe, expect, it } from 'vitest';
import { checkSqlDefaultBody, reservedSqlDefaultBody } from '../src/default-sql-body';

describe('reservedSqlDefaultBody', () => {
  it.each([
    ['now()', 'now'],
    [' now() ', 'now'],
    ['autoincrement()', 'autoincrement'],
    ['\n  autoincrement()\n', 'autoincrement'],
  ] as const)('names the Prisma default function %j spells', (body, name) => {
    expect(reservedSqlDefaultBody(body)).toBe(name);
  });

  it.each([
    ['NOW()'],
    ['now ()'],
    ['gen_random_uuid()'],
    ['uuid()'],
    ["now() + interval '1 day'"],
    ['CURRENT_TIMESTAMP'],
    [''],
  ])('passes %j as raw SQL', (body) => {
    expect(reservedSqlDefaultBody(body)).toBeUndefined();
  });
});

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
    expect(checkSqlDefaultBody(body)).toBe(
      'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
    );
  });
});
