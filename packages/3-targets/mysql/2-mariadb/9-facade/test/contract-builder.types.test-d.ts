import type { DefaultModelRow } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const contract = defineContract({}, ({ type, field, model, gen }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.Int()).id(),
        token: field.column(type.sql.Char(26)).onCreate(gen.ulid()),
        at: field.column(type.DateTime()),
        day: field.column(type.Date()),
      },
    }),
  },
}));

type EventRow = DefaultModelRow<typeof contract, 'Event'>;

test("MariaDB's defineContract builds a contract for the MariaDB target, typed with MySQL's types", () => {
  expectTypeOf(contract.target).toEqualTypeOf<'mariadb'>();
  expectTypeOf<EventRow['id']>().toEqualTypeOf<number>();
  expectTypeOf<EventRow['token']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<Date>();
  expectTypeOf<EventRow['day']>().toEqualTypeOf<string>();
});
