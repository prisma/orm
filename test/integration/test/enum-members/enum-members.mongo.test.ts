import mongoStatic from '@internal/mongo/static';
import { Double, Int32, Long } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';
import type { Contract } from './_fixture-mongo/generated/contract';
import contractJson from './_fixture-mongo/generated/contract.json' with { type: 'json' };

const { enums } = mongoStatic<Contract>({ contractJson });

const sunset = new Date('2025-06-30T12:00:00.000Z');

describe('db.enums on a Mongo contract emitted from PSL', () => {
  it(
    'finds every value read from the database, and holds each member as the value read',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        // The collection validator lists each enum's stored forms, which an int64 or a date
        // value does not match, so the document is written past it.
        await mongoDb.collection('readings').insertOne(
          {
            text: 'high',
            int32: new Int32(10),
            int64: Long.fromNumber(10),
            date: sunset,
            double: new Double(2.25),
          },
          { bypassDocumentValidation: true },
        );
        const row = await db.readings.first();
        if (row === null) expect.unreachable('the document reads back');

        expect({
          has: [
            enums.TextLevel.has(row.text),
            enums.Int32Level.has(row.int32),
            enums.Int64Level.has(row.int64),
            enums.DateLevel.has(row.date),
            enums.DoubleLevel.has(row.double),
          ],
          equal: [
            enums.TextLevel.members.High === row.text,
            enums.Int32Level.members.High === row.int32,
            enums.Int64Level.members.High === row.int64,
            enums.DateLevel.members.Sunset.getTime() === row.date.getTime(),
            enums.DoubleLevel.members.Whole === row.double,
          ],
        }).toEqual({
          has: [true, true, true, true, true],
          equal: [true, true, true, true, true],
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it('types each member as the value a query returns for it', () => {
    expectTypeOf(enums.TextLevel.members.Low).toEqualTypeOf<'low'>();
    expectTypeOf(enums.Int32Level.members.Low).toEqualTypeOf<1>();
    expectTypeOf(enums.Int64Level.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(enums.DateLevel.members.Launch).toEqualTypeOf<Date>();
    expectTypeOf(enums.DoubleLevel.members.Half).toEqualTypeOf<1.5>();
  });
});
