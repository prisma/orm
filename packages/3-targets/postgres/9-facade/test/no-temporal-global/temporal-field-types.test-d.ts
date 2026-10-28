import type { DefaultModelRow } from '@internal/sql-orm-client';
import type { CodecTypes } from '@internal/target-postgres/codec-types';
import type { Temporal } from 'temporal-spec';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

const contract = defineContract({}, ({ type, field, model, gen }) => ({
  models: {
    Event: model('Event', {
      fields: {
        id: field.column(type.Uuid()).id().onCreate(gen.uuid()),
        at: field.column(type.TimestamptzTemporal(3)),
        local: field.column(type.TimestampTemporal()),
        day: field.column(type.DateTemporal()),
        opens: field.column(type.TimeTemporal(0)),
        legacyDay: field.column(type.Date()),
        utcAt: field.column(type.TimestampInstant(6)),
        utcDate: field.column(type.TimestampJsDate(3)),
        span: field.column(type.IntervalString(3)),
      },
    }),
  },
}));

type EventRow = DefaultModelRow<typeof contract, 'Event'>;

test('a Temporal field is typed precisely in a project without the global Temporal declarations', () => {
  expectTypeOf<EventRow['at']>().not.toBeAny();
  expectTypeOf<EventRow['at']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<EventRow['local']>().toEqualTypeOf<Temporal.PlainDateTime>();
  expectTypeOf<EventRow['day']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<EventRow['opens']>().toEqualTypeOf<Temporal.PlainTime>();
  expectTypeOf<EventRow['legacyDay']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<EventRow['utcAt']>().not.toBeAny();
  expectTypeOf<EventRow['utcAt']>().toEqualTypeOf<Temporal.Instant>();
});

test('every Temporal codec names its type through an import', () => {
  expectTypeOf<CodecTypes['pg/timestamptz-temporal@1']['output']>().not.toBeAny();
  expectTypeOf<
    CodecTypes['pg/timestamptz-temporal@1']['output']
  >().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<
    CodecTypes['pg/timestamp-temporal@1']['output']
  >().toEqualTypeOf<Temporal.PlainDateTime>();
  expectTypeOf<CodecTypes['pg/date-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<CodecTypes['pg/time-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainTime>();
  expectTypeOf<CodecTypes['pg/timestamp-instant@1']['output']>().not.toBeAny();
  expectTypeOf<CodecTypes['pg/timestamp-instant@1']['output']>().toEqualTypeOf<Temporal.Instant>();
});

test('a timestamp read as a Date reads a Date, and an interval read as a string reads a string', () => {
  expectTypeOf<EventRow['utcDate']>().toEqualTypeOf<Date>();
  expectTypeOf<EventRow['span']>().toEqualTypeOf<string>();
});
