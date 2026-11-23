import type { BetterAuthOptions } from '@better-auth/core';
import type { Where } from '@better-auth/core/db/adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/adapter';
import { type AdapterDatabases, createAdapterDatabases } from '../helpers/adapter-databases';
import { pslForConfiguration } from '../helpers/printed-psl';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const ticketOptions: BetterAuthOptions = {
  plugins: [
    {
      id: 'tickets',
      schema: { ticket: { fields: { status: { type: ['open', 'closed'] } } } },
    },
  ],
};

describe('filters on a native enum field on postgres', () => {
  let adapter: ReturnType<ReturnType<typeof prismaAdapter>>;

  beforeAll(async () => {
    const psl = `${pslForConfiguration(databases.emptyContract('postgres'), ticketOptions).replace(
      /(model Ticket \{[^}]*\n\s+status\s+)String/,
      '$1pg.enum(TicketStatus)',
    )}
native_enum TicketStatus {
  open = "open"
  closed = "closed"
}
`;
    if (!psl.includes('pg.enum(TicketStatus)')) throw new Error('No Ticket.status field');
    adapter = prismaAdapter(await databases.open('postgres', psl))(ticketOptions);
    for (const [id, status] of [
      ['t1', 'open'],
      ['t2', 'closed'],
    ]) {
      await adapter.create({ model: 'ticket', data: { id, status }, forceAllowId: true });
    }
  }, timeouts.hook);

  async function ids(where: Where[]): Promise<string[]> {
    const found = await adapter.findMany<{ id: string }>({ model: 'ticket', where, limit: 100 });
    return found.map((row) => row.id).sort();
  }

  it('eq and in match by value', async () => {
    expect(await ids([{ field: 'status', value: 'open' }])).toEqual(['t1']);
    expect(await ids([{ field: 'status', operator: 'in', value: ['open', 'closed'] }])).toEqual([
      't1',
      't2',
    ]);
  });

  it('refuses pattern operators and case-insensitive comparison with the adapter’s error', async () => {
    const refused: readonly [Where, string][] = [
      [{ field: 'status', operator: 'contains', value: 'pe' }, 'contains'],
      [{ field: 'status', operator: 'starts_with', value: 'o' }, 'starts_with'],
      [{ field: 'status', operator: 'ends_with', value: 'n' }, 'ends_with'],
      [{ field: 'status', operator: 'eq', value: 'OPEN', mode: 'insensitive' }, 'eq'],
    ];
    for (const [where, operator] of refused) {
      await expect(ids([where])).rejects.toThrow(
        `Field "Ticket.status" (pg/enum@1) does not support ${operator}.`,
      );
    }
  });
});
