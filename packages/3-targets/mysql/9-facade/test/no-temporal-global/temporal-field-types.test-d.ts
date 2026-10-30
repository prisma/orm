import type { DefaultModelRow } from '@internal/sql-orm-client';
import type { CodecTypes } from '@internal/target-mysql/codec-types';
import type { Temporal } from 'temporal-spec';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

const contract = defineContract({}, ({ type, field, model }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.Int()).id(),
        at: field.column(type.DateTime()),
        exactAt: field.column(type.DateTime({ as: 'temporal' })),
        textAt: field.column(type.DateTime({ as: 'string' })),
        stamp: field.column(type.DateTime({ storage: 'timestamp' })),
        stampT: field.column(type.DateTime({ as: 'temporal', storage: 'timestamp' })),
        day: field.column(type.Date()),
        dayT: field.column(type.Date({ as: 'temporal' })),
        opensAt: field.column(type.Time()),
        opensAtT: field.column(type.Time({ as: 'temporal', precision: 3 })),
        lasts: field.column(type.Duration()),
        atExplicit: field.column(type.DatetimeJsDate(3)),
      },
    }),
  },
}));

type EventRow = DefaultModelRow<typeof contract, 'Event'>;

test('a MySQL convenience type is typed as the value of the explicit type it chooses, without the global Temporal declarations', () => {
  expectTypeOf<EventRow['exactAt']>().not.toBeAny();
  expectTypeOf<EventRow['exactAt']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<EventRow['stampT']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<EventRow['dayT']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<EventRow['opensAtT']>().toEqualTypeOf<Temporal.PlainTime>();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<Date>();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<EventRow['atExplicit']>();
  expectTypeOf<EventRow['stamp']>().toEqualTypeOf<Date>();
  expectTypeOf<EventRow['textAt']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['day']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['opensAt']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['lasts']>().toEqualTypeOf<string>();
});

test('every MySQL Temporal codec names its type through an import', () => {
  expectTypeOf<CodecTypes['mysql/datetime-temporal@1']['output']>().not.toBeAny();
  expectTypeOf<
    CodecTypes['mysql/datetime-temporal@1']['output']
  >().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<
    CodecTypes['mysql/timestamp-temporal@1']['output']
  >().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<CodecTypes['mysql/date-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<CodecTypes['mysql/time-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainTime>();
});

test('each MySQL convenience type call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.DateTime({ as: 'temporal' })).toEqualTypeOf(type.DatetimeTemporal(6));
    expectTypeOf(type.DateTime({ storage: 'timestamp' })).toEqualTypeOf(type.TimestampJsDate(3));
    expectTypeOf(type.Date()).toEqualTypeOf(type.DateString());
    expectTypeOf(type.Date({ as: 'temporal' })).toEqualTypeOf(type.DateTemporal());
    expectTypeOf(type.Duration()).toEqualTypeOf(type.DurationString());
    return { models: {} };
  });
});

test('a MySQL convenience type helper refuses a combination with no explicit type', () => {
  defineContract({}, ({ type, field, model }) => ({
    models: {
      Event: model('Event', {
        fields: {
          id: field.column(type.Int()).id(),
          // @ts-expect-error a calendar date is never a JavaScript Date
          day: field.column(type.Date({ as: 'jsDate' })),
          // @ts-expect-error MySQL stores a moment in time as datetime or timestamp
          at: field.column(type.DateTime({ storage: 'timestamptz' })),
          // @ts-expect-error a duration is read only as a string
          lasts: field.column(type.Duration({ as: 'temporal' })),
          // @ts-expect-error a date takes no precision
          birthday: field.column(type.Date({ precision: 3 })),
        },
      }),
    },
  }));
});
