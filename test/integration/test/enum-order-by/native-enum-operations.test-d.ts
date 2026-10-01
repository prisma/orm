/**
 * Postgres has no `LIKE`, `ILIKE` or text-search function over a native enum type, so a native enum column offers none of the operations built on them. It still compares, orders, and takes `min`/`max`, which PostgreSQL returns as the enum type.
 */

import type { Db } from '@internal/sql-builder';
import type { Collection, ModelAccessor } from '@internal/sql-orm-client';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { expectTypeOf, test } from 'vitest';
import type { CodecTypes, Contract } from './_fixture/generated/contract';

type TicketAccessor = ModelAccessor<Contract, 'Ticket'>;

declare const db: Db<Contract>;
declare const tickets: Collection<Contract, 'Ticket'>;

test('an ORM native enum field has no pattern or full-text operations', () => {
  expectTypeOf<TicketAccessor['status']>().not.toHaveProperty('like');
  expectTypeOf<TicketAccessor['status']>().not.toHaveProperty('ilike');
  expectTypeOf<TicketAccessor['status']>().not.toHaveProperty('fullTextMatches');
  expectTypeOf<TicketAccessor['status']>().not.toHaveProperty('fullTextRank');
  expectTypeOf<TicketAccessor['status']>().not.toHaveProperty('fullTextHeadline');
});

test('an ORM native enum field still compares and orders', () => {
  expectTypeOf<TicketAccessor['status']>().toHaveProperty('eq');
  expectTypeOf<TicketAccessor['status']>().toHaveProperty('in');
  expectTypeOf<TicketAccessor['status']>().toHaveProperty('gt');
  expectTypeOf<TicketAccessor['status']>().toHaveProperty('asc');
});

test('the SQL builder refuses a native enum column as the text of ilike or a search', () => {
  db.public.tickets
    .select('id')
    // @ts-expect-error Postgres has no ILIKE over a native enum type
    .where((f, fns) => fns.ilike(f.status, '%open%'));
  db.public.tickets
    .select('id')
    // @ts-expect-error Postgres has no to_tsvector over a native enum type
    .where((f, fns) => fns.fullTextMatches(f.status, fns.websearchToTsquery('open')));
  db.public.tickets
    .select('id')
    // @ts-expect-error the same holds for rank
    .select('rank', (f, fns) => fns.fullTextRank(f.status, fns.websearchToTsquery('open')));
  db.public.tickets
    .select('id')
    // @ts-expect-error and for headline
    .select('snippet', (f, fns) => fns.fullTextHeadline(f.status, fns.websearchToTsquery('open')));
  db.public.tickets
    .select('id')
    // @ts-expect-error a parser takes text, and a native enum column is not text to Postgres
    .select('query', (f, fns) => fns.websearchToTsquery(f.status));
  // @ts-expect-error the imported parser refuses it the same way
  websearchToTsquery(null as unknown as TicketAccessor['status']);
});

test('min and max over a native enum still resolve, to the enum codec', () => {
  type EnumValue = CodecTypes['pg/enum@1']['output'];

  expectTypeOf(
    tickets.aggregate((agg) => ({ lowest: agg.min('status'), highest: agg.max('status') })),
  ).resolves.toEqualTypeOf<{ lowest: EnumValue | null; highest: EnumValue | null }>();
});
