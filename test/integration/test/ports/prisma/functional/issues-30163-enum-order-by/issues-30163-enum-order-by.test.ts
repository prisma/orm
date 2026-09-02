import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function withIssue30163(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

const tickets = [
  { id: 1, status: 'closed' },
  { id: 2, status: 'open' },
  { id: 3, status: 'closed' },
  { id: 4, status: 'open' },
] as const;

describe('ports/prisma/functional/issues-30163-enum-order-by', () => {
  it(
    'orders ascending by a native enum column in declaration order',
    () =>
      withIssue30163(async ({ db }) => {
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
    'orders descending by a native enum column in reverse declaration order',
    () =>
      withIssue30163(async ({ db }) => {
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
});
