import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withEnumOrderBy(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

const tickets = [
  { id: 1, status: 'closed' },
  { id: 2, status: 'open' },
  { id: 3, status: 'closed' },
  { id: 4, status: 'open' },
] as const;

describe('ordering by a native enum column', () => {
  it(
    'sorts ascending in declaration order',
    () =>
      withEnumOrderBy(async ({ db }) => {
        await db.public.Ticket.createAndCount([...tickets]);

        const rows = await db.public.Ticket.orderBy([
          (ticket) => ticket.status.asc(),
          (ticket) => ticket.id.asc(),
        ])
          .select('id', 'status')
          .all();

        expect(rows).toEqual([
          { id: 2, status: 'open' },
          { id: 4, status: 'open' },
          { id: 1, status: 'closed' },
          { id: 3, status: 'closed' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'sorts descending in reverse declaration order',
    () =>
      withEnumOrderBy(async ({ db }) => {
        await db.public.Ticket.createAndCount([...tickets]);

        const rows = await db.public.Ticket.orderBy([
          (ticket) => ticket.status.desc(),
          (ticket) => ticket.id.asc(),
        ])
          .select('id', 'status')
          .all();

        expect(rows).toEqual([
          { id: 1, status: 'closed' },
          { id: 3, status: 'closed' },
          { id: 2, status: 'open' },
          { id: 4, status: 'open' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'distinctOn keeps one row per enum value',
    () =>
      withEnumOrderBy(async ({ db }) => {
        await db.public.Ticket.createAndCount([...tickets]);

        const rows = await db.public.Ticket.select('id', 'status')
          .orderBy([(ticket) => ticket.status.asc(), (ticket) => ticket.id.asc()])
          .distinctOn('status')
          .all();

        expect(rows).toEqual([
          { id: 2, status: 'open' },
          { id: 1, status: 'closed' },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
