import { describe, expect, it } from 'vitest';
import { reservedSqlDefaultBody } from '../src/default-sql-body';

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
