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
  it('returns undefined for a safe body with no unsafe tokens', () => {
    expect(checkSqlDefaultBody('now()')).toBeUndefined();
  });

  it.each([
    ['id = 1; DROP TABLE users'],
    ['1 -- comment'],
    ['/* comment */ 1'],
    ['$$ dollar quoted $$'],
    ['SELECT 1'],
    ['select 1'],
  ])('flags %j as unsafe', (body) => {
    expect(checkSqlDefaultBody(body)).toBe(
      'Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
    );
  });
});
