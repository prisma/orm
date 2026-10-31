import type { DefaultModelRow } from '@internal/sql-orm-client';
import type { CodecTypes } from '@internal/target-sqlite/codec-types';
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
        day: field.column(type.Date()),
        dayT: field.column(type.Date({ as: 'temporal' })),
        opensAt: field.column(type.Time()),
        opensAtT: field.column(type.Time({ as: 'temporal', storage: 'text' })),
        lasts: field.column(type.Duration()),
        atExplicit: field.column(type.DatetimeJsDate()),
        textAtExplicit: field.column(type.DatetimeString()),
      },
    }),
  },
}));

type EventRow = DefaultModelRow<typeof contract, 'Event'>;

test('a convenience type is typed as the value of the explicit type it chooses, without the global Temporal declarations', () => {
  expectTypeOf<EventRow['exactAt']>().not.toBeAny();
  expectTypeOf<EventRow['exactAt']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<EventRow['dayT']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<EventRow['opensAtT']>().toEqualTypeOf<Temporal.PlainTime>();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<Date>();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<EventRow['atExplicit']>();
  expectTypeOf<EventRow['textAt']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['textAt']>().toEqualTypeOf<EventRow['textAtExplicit']>();
  expectTypeOf<EventRow['day']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['opensAt']>().toEqualTypeOf<string>();
  expectTypeOf<EventRow['lasts']>().toEqualTypeOf<string>();
});

test('every Temporal codec names its type through an import', () => {
  expectTypeOf<CodecTypes['sqlite/datetime-temporal@1']['output']>().not.toBeAny();
  expectTypeOf<
    CodecTypes['sqlite/datetime-temporal@1']['output']
  >().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<
    CodecTypes['sqlite/date-temporal@1']['output']
  >().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<
    CodecTypes['sqlite/time-temporal@1']['output']
  >().toEqualTypeOf<Temporal.PlainTime>();
});

test('each convenience type call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.DateTime()).toEqualTypeOf(type.DatetimeJsDate());
    expectTypeOf(type.DateTime({ as: 'jsDate', storage: 'text' })).toEqualTypeOf(
      type.DatetimeJsDate(),
    );
    expectTypeOf(type.DateTime({ as: 'temporal' })).toEqualTypeOf(type.DatetimeTemporal());
    expectTypeOf(type.DateTime({ as: 'string' })).toEqualTypeOf(type.DatetimeString());
    expectTypeOf(type.Date()).toEqualTypeOf(type.DateString());
    expectTypeOf(type.Date({ as: 'temporal' })).toEqualTypeOf(type.DateTemporal());
    expectTypeOf(type.Time()).toEqualTypeOf(type.TimeString());
    expectTypeOf(type.Time({ as: 'temporal' })).toEqualTypeOf(type.TimeTemporal());
    expectTypeOf(type.Duration()).toEqualTypeOf(type.DurationString());
    return { models: {} };
  });
});

test('a convenience type helper refuses a combination with no explicit type', () => {
  defineContract({}, ({ type, field, model }) => ({
    models: {
      Event: model('Event', {
        fields: {
          id: field.column(type.Int()).id(),
          // @ts-expect-error a calendar date is never a JavaScript Date
          day: field.column(type.Date({ as: 'jsDate' })),
          // @ts-expect-error SQLite stores every date and time type as text
          at: field.column(type.DateTime({ storage: 'timestamptz' })),
          // @ts-expect-error a duration is read only as a string
          lasts: field.column(type.Duration({ as: 'temporal' })),
          // @ts-expect-error SQLite's date and time types take no precision
          opens: field.column(type.Time({ precision: 3 })),
        },
      }),
    },
  }));
});
