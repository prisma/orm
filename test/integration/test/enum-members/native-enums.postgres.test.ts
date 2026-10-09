import postgres from '@internal/postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './_fixture-native-enums/generated/contract';
import contractJson from './_fixture-native-enums/generated/contract.json' with { type: 'json' };

describe('db.nativeEnums on a contract emitted from PSL', () => {
  const db = postgres<Contract>({ contractJson });

  it('lists the native enums, a mapped one and an unused one, and no domain enum', () => {
    expect({
      nativeEnums: Object.keys(db.nativeEnums.public).sort(),
      ticketStatus: db.nativeEnums.public.TicketStatus.values,
      unused: db.nativeEnums.public.Unused.values,
      enums: Object.keys(db.enums.public),
    }).toEqual({
      nativeEnums: ['TicketStatus', 'Unused'],
      ticketStatus: ['open', 'closed'],
      unused: ['one', 'two'],
      enums: ['Priority'],
    });
  });

  it('types only the native enums', () => {
    expectTypeOf<keyof typeof db.nativeEnums.public>().toEqualTypeOf<'TicketStatus' | 'Unused'>();
  });
});
