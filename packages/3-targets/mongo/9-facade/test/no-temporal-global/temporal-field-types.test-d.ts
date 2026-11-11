import type { InferModelRow } from '@internal/mongo-contract';
import type { CodecTypes } from '@internal/target-mongo/codec-types';
import type { Temporal } from 'temporal-spec';
import { expectTypeOf, test } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

const contract = defineContract({}, ({ type, field, model }) => ({
  models: {
    Event: model('Event', {
      collection: 'events',
      fields: {
        _id: field.scalar(type.ObjectId()),
        at: field.scalar(type.DateTime()),
        exactAt: field.scalar(type.DateTime({ as: 'temporal' })),
        textAt: field.scalar(type.DateTime({ as: 'string' })),
        day: field.scalar(type.Date()),
        dayT: field.scalar(type.Date({ as: 'temporal' })),
        opensAt: field.scalar(type.Time()),
        opensAtT: field.scalar(type.Time({ as: 'temporal', storage: 'string' })),
        lasts: field.scalar(type.Duration()),
        atExplicit: field.scalar(type.DateJsDate()),
        textAtExplicit: field.scalar(type.DateInstantString()),
      },
    }),
  },
}));

type EventRow = InferModelRow<typeof contract, 'Event'>;

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
  expectTypeOf<CodecTypes['mongo/date-instant@1']['output']>().not.toBeAny();
  expectTypeOf<CodecTypes['mongo/date-instant@1']['output']>().toEqualTypeOf<Temporal.Instant>();
  expectTypeOf<CodecTypes['mongo/date-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainDate>();
  expectTypeOf<CodecTypes['mongo/time-temporal@1']['output']>().toEqualTypeOf<Temporal.PlainTime>();
});

test('each convenience type call has the type of the explicit type helper it chooses', () => {
  defineContract({}, ({ type }) => {
    expectTypeOf(type.DateTime()).toEqualTypeOf(type.DateJsDate());
    expectTypeOf(type.DateTime({ as: 'jsDate', storage: 'date' })).toEqualTypeOf(type.DateJsDate());
    expectTypeOf(type.DateTime({ as: 'temporal' })).toEqualTypeOf(type.DateInstant());
    expectTypeOf(type.DateTime({ as: 'string' })).toEqualTypeOf(type.DateInstantString());
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
        collection: 'events',
        fields: {
          _id: field.scalar(type.ObjectId()),
          // @ts-expect-error a calendar date is never a JavaScript Date
          day: field.scalar(type.Date({ as: 'jsDate' })),
          // @ts-expect-error an instant is stored as a BSON date
          at: field.scalar(type.DateTime({ storage: 'string' })),
          // @ts-expect-error a duration is read only as a string
          lasts: field.scalar(type.Duration({ as: 'temporal' })),
          // @ts-expect-error a time of day is stored as a BSON string
          opens: field.scalar(type.Time({ storage: 'date' })),
        },
      }),
    },
  }));
});
