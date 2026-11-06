import { describe, expect, it } from 'vitest';
import { isUnfilledSlot, slotSource, sqlOfSlot } from '../src/core/migrations/sql-slot';
import { createSqlTextSources } from '../src/core/migrations/sql-text-sources';

const written = { kind: 'sql', sql: '"age"::int4' } as const;
const unfilled = { kind: 'placeholder', slot: 'User.age:convert' } as const;

describe('SqlSlot', () => {
  it('renders written SQL as a sql template and an unfilled slot as a placeholder call', () => {
    const sql = createSqlTextSources('@internal/postgres/migration');
    expect({
      sources: [slotSource(written, sql), slotSource(unfilled, sql)],
      imports: sql.imports(),
    }).toEqual({
      sources: ['sql`"age"::int4`', 'placeholder("User.age:convert")'],
      imports: [{ moduleSpecifier: '@internal/postgres/migration', symbol: 'sql' }],
    });
  });

  it('tells an unfilled slot from written SQL, and gives the SQL of a written one', () => {
    expect([
      isUnfilledSlot(written),
      isUnfilledSlot(unfilled),
      isUnfilledSlot(undefined),
      sqlOfSlot(written),
      sqlOfSlot(unfilled),
      sqlOfSlot(undefined),
    ]).toEqual([false, true, false, '"age"::int4', undefined, undefined]);
  });
});
