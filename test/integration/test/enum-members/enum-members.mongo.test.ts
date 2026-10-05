import mongoStatic from '@internal/mongo/static';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';
import type { Contract } from './_fixture-mongo/generated/contract';
import contractJson from './_fixture-mongo/generated/contract.json' with { type: 'json' };

const { enums } = mongoStatic<Contract>({ contractJson });

describe('db.enums on a Mongo contract emitted from PSL', () => {
  it(
    'writes members through the ORM past the collection validator, and finds every value read',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await db.readings.create({
          text: enums.TextLevel.members.High,
          int32: enums.Int32Level.members.High,
          double: enums.DoubleLevel.members.Whole,
        });
        const row = await db.readings.first();
        if (row === null) expect.unreachable('the document reads back');

        expect({
          has: [
            enums.TextLevel.has(row.text),
            enums.Int32Level.has(row.int32),
            enums.DoubleLevel.has(row.double),
          ],
          equal: [
            enums.TextLevel.members.High === row.text,
            enums.Int32Level.members.High === row.int32,
            enums.DoubleLevel.members.Whole === row.double,
          ],
        }).toEqual({
          has: [true, true, true],
          equal: [true, true, true],
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it('types each member as the value a query returns for it', () => {
    expectTypeOf(enums.TextLevel.members.Low).toEqualTypeOf<'low'>();
    expectTypeOf(enums.Int32Level.members.Low).toEqualTypeOf<1>();
    expectTypeOf(enums.DoubleLevel.members.Half).toEqualTypeOf<1.5>();
  });
});
