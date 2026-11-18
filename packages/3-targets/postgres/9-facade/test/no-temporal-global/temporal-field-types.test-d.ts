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

const convenience = defineContract({}, ({ type, field, model, gen }) => ({
  models: {
    Order: model('Order', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
        paidAt: field.column(type.DateTime()),
        settledAt: field.column(type.DateTime({ as: 'temporal' })),
        textAt: field.column(type.DateTime({ as: 'string', precision: 6 })),
        legacyAt: field.column(type.DateTime({ storage: 'timestamp' })),
        utcAt: field.column(type.DateTime({ as: 'temporal', storage: 'timestamp' })),
        shipBy: field.column(type.Date()),
        shipOn: field.column(type.Date({ as: 'temporal' })),
        opensAt: field.column(type.Time({ precision: 0 })),
        opensAtT: field.column(type.Time({ as: 'temporal' })),
        localAt: field.column(type.Time({ storage: 'timetz' })),
        period: field.column(type.Duration()),
        parts: field.column(type.Duration({ as: 'parts' })),
        textAtExplicit: field.column(type.TimestamptzString(6)),
        opensAtExplicit: field.column(type.TimeString(0)),
        localAtExplicit: field.column(type.Timetz()),
        partsExplicit: field.column(type.IntervalParts()),
      },
    }),
  },
}));

type OrderRow = DefaultModelRow<typeof convenience, 'Order'>;

test('a convenience type is typed as the value of the explicit type it chooses', () => {
  expectTypeOf<OrderRow['paidAt']>().toEqualTypeOf<Date>();
  expectTypeOf<OrderRow['settledAt']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<OrderRow['textAt']>().toEqualTypeOf<OrderRow['textAtExplicit']>();
  expectTypeOf<OrderRow['legacyAt']>().toEqualTypeOf<Date>();
  expectTypeOf<OrderRow['utcAt']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<OrderRow['shipBy']>().toEqualTypeOf<string>();
  expectTypeOf<OrderRow['shipOn']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<OrderRow['opensAt']>().toEqualTypeOf<OrderRow['opensAtExplicit']>();
  expectTypeOf<OrderRow['opensAtT']>().toEqualTypeOf<Temporal.PlainTime>();
  expectTypeOf<OrderRow['localAt']>().toEqualTypeOf<OrderRow['localAtExplicit']>();
  expectTypeOf<OrderRow['period']>().toEqualTypeOf<string>();
  expectTypeOf<OrderRow['parts']>().not.toBeAny();
  expectTypeOf<OrderRow['parts']>().toEqualTypeOf<OrderRow['partsExplicit']>();
});

test('a convenience type helper refuses a combination with no explicit type', () => {
  defineContract({}, ({ type, field, model, gen }) => ({
    models: {
      Order: model('Order', {
        fields: {
          id: field.column(type.Char(36)).id().onCreate(gen.uuid()),
          // @ts-expect-error Temporal.PlainTime cannot hold a timetz offset
          at: field.column(type.Time({ as: 'temporal', storage: 'timetz' })),
          // @ts-expect-error a calendar date is never a JavaScript Date
          day: field.column(type.Date({ as: 'jsDate' })),
          // @ts-expect-error a calendar date has no precision
          dayAt: field.column(type.Date({ precision: 3 })),
          // @ts-expect-error the options are as and storage
          stamp: field.column(type.DateTime({ value: 'string' })),
          // @ts-expect-error a precision is written by name
          opens: field.column(type.Time(3)),
        },
      }),
    },
  }));
});

test('each convenience type call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.DateTime()).toEqualTypeOf(type.TimestamptzJsDate(3));
    expectTypeOf(type.DateTime({ precision: 6 })).toEqualTypeOf(type.TimestamptzJsDate(6));
    expectTypeOf(type.DateTime({ as: 'jsDate', storage: 'timestamptz' })).toEqualTypeOf(
      type.TimestamptzJsDate(3),
    );
    expectTypeOf(type.DateTime({ as: 'temporal' })).toEqualTypeOf(type.TimestamptzTemporal());
    expectTypeOf(type.DateTime({ as: 'temporal', precision: 3 })).toEqualTypeOf(
      type.TimestamptzTemporal(3),
    );
    expectTypeOf(type.DateTime({ as: 'string' })).toEqualTypeOf(type.TimestamptzString());
    expectTypeOf(
      type.DateTime({ as: 'string', storage: 'timestamptz', precision: 6 }),
    ).toEqualTypeOf(type.TimestamptzString(6));
    expectTypeOf(type.DateTime({ storage: 'timestamp' })).toEqualTypeOf(type.TimestampJsDate(3));
    expectTypeOf(type.DateTime({ as: 'jsDate', storage: 'timestamp', precision: 0 })).toEqualTypeOf(
      type.TimestampJsDate(0),
    );
    expectTypeOf(type.DateTime({ as: 'temporal', storage: 'timestamp' })).toEqualTypeOf(
      type.TimestampInstant(),
    );
    expectTypeOf(
      type.DateTime({ as: 'temporal', storage: 'timestamp', precision: 6 }),
    ).toEqualTypeOf(type.TimestampInstant(6));
    expectTypeOf(type.DateTime({ as: 'string', storage: 'timestamp' })).toEqualTypeOf(
      type.TimestampString(),
    );
    expectTypeOf(type.DateTime({ as: 'string', storage: 'timestamp', precision: 3 })).toEqualTypeOf(
      type.TimestampString(3),
    );
    expectTypeOf(type.Date()).toEqualTypeOf(type.DateString());
    expectTypeOf(type.Date({ as: 'string', storage: 'date' })).toEqualTypeOf(type.DateString());
    expectTypeOf(type.Date({ as: 'temporal' })).toEqualTypeOf(type.DateTemporal());
    expectTypeOf(type.Time()).toEqualTypeOf(type.TimeString());
    expectTypeOf(type.Time({ precision: 0 })).toEqualTypeOf(type.TimeString(0));
    expectTypeOf(type.Time({ as: 'temporal' })).toEqualTypeOf(type.TimeTemporal());
    expectTypeOf(type.Time({ as: 'temporal', storage: 'time', precision: 3 })).toEqualTypeOf(
      type.TimeTemporal(3),
    );
    expectTypeOf(type.Time({ as: 'string', storage: 'timetz' })).toEqualTypeOf(type.Timetz());
    expectTypeOf(type.Time({ storage: 'timetz', precision: 2 })).toEqualTypeOf(type.Timetz(2));
    expectTypeOf(type.Duration()).toEqualTypeOf(type.IntervalString());
    expectTypeOf(type.Duration({ precision: 3 })).toEqualTypeOf(type.IntervalString(3));
    expectTypeOf(type.Duration({ as: 'parts' })).toEqualTypeOf(type.IntervalParts());
    expectTypeOf(type.Duration({ as: 'parts', storage: 'interval', precision: 6 })).toEqualTypeOf(
      type.IntervalParts(6),
    );
    const widened: number = 4;
    expectTypeOf(type.DateTime({ as: 'string', precision: widened })).toEqualTypeOf(
      type.TimestamptzString(widened),
    );
    expectTypeOf(type.DateTime({ precision: widened })).not.toEqualTypeOf(
      type.TimestamptzString(widened),
    );
    return { models: {} };
  });
});
