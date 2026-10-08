import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { defineContract, enumType, field, member, model } from '@internal/mongo/contract-builder';
import mongoStatic from '@internal/mongo/static';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';

const TextLevel = enumType(
  'TextLevel',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('Low', 'low'),
  member('High', 'high'),
);
const Int64Level = enumType(
  'Int64Level',
  { codecId: 'mongo/int64@1', nativeType: 'long' },
  member('Low', 1n),
  member('High', 10n),
);
const DateLevel = enumType(
  'DateLevel',
  { codecId: 'mongo/date@1', nativeType: 'date' },
  member('Launch', new Date('2024-01-01T00:00:00.000Z')),
  member('Sunset', new Date('2025-06-30T12:00:00.000Z')),
);

const contract = defineContract({
  enums: { TextLevel, Int64Level, DateLevel },
  models: {
    Reading: model('Reading', {
      collection: 'readings',
      fields: {
        _id: field.objectId(),
        text: field.namedType(TextLevel),
        int64: field.namedType(Int64Level),
        date: field.namedType(DateLevel),
      },
    }),
  },
});
type Contract = typeof contract;
const contractJson = new MongoContractSerializer().serializeContract(contract);
const { enums } = mongoStatic<Contract>({ contractJson });

describe('db.enums on a Mongo contract built with TypeScript', () => {
  it(
    'writes int64 and date members through the ORM, and finds every value read',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await db.readings.create({
          text: enums.TextLevel.members.High,
          int64: enums.Int64Level.members.High,
          date: enums.DateLevel.members.Sunset,
        });
        const row = await db.readings.first();
        if (row === null) expect.unreachable('the document reads back');

        expect({
          has: [
            enums.TextLevel.has(row.text),
            enums.Int64Level.has(row.int64),
            enums.DateLevel.has(row.date),
          ],
          equal: [
            enums.Int64Level.members.High === row.int64,
            enums.DateLevel.members.Sunset.getTime() === row.date.getTime(),
          ],
        }).toEqual({ has: [true, true, true], equal: [true, true] });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuses a value outside the enum and names it without failing to describe it',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.readings.create({
            text: 'low',
            int64: 11n as never,
            date: enums.DateLevel.members.Launch,
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field int64 in collection 'readings': 11n is not a value of enum Int64Level; the values are 1n and 10n",
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it('types each member as the value a query returns for it', () => {
    expectTypeOf(enums.Int64Level.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(enums.DateLevel.members.Launch).toEqualTypeOf<Date>();
  });
});
