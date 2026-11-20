import { MongoContractSerializer } from '@internal/family-mongo/ir';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
  type,
} from '@internal/mongo/contract-builder';
import mongoStatic, { contractFromJson } from '@internal/mongo/static';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';

const TextLevel = enumType(
  'TextLevel',
  { codecId: 'mongo/string@1' },
  member('Low', 'low'),
  member('High', 'high'),
);
const Int32Level = enumType(
  'Int32Level',
  { codecId: 'mongo/int32@1' },
  member('Low', 1),
  member('High', 10),
);
const DoubleLevel = enumType(
  'DoubleLevel',
  { codecId: 'mongo/double@1' },
  member('Half', 1.5),
  member('Whole', 2.25),
);

const contract = defineContract({
  enums: { TextLevel, Int32Level, DoubleLevel },
  models: {
    Reading: model('Reading', {
      collection: 'readings',
      fields: {
        _id: field.scalar(type.ObjectId()),
        text: field.namedType(TextLevel),
        int32: field.namedType(Int32Level),
        double: field.namedType(DoubleLevel),
      },
    }),
  },
});
type Contract = typeof contract;
const contractJson = new MongoContractSerializer().serializeContract(contract);
const { enums } = mongoStatic({ contract: contractFromJson<Contract>(contractJson) });

describe('db.enums on a Mongo contract built with TypeScript', () => {
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
        }).toEqual({ has: [true, true, true], equal: [true, true, true] });
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
            int32: 11 as never,
            double: enums.DoubleLevel.members.Half,
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field int32 in collection 'readings': 11 is not a value of enum Int32Level; the values are 1 and 10",
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it('types each member as the value a query returns for it', () => {
    expectTypeOf(enums.Int32Level.members.Low).toEqualTypeOf<1>();
    expectTypeOf(enums.DoubleLevel.members.Half).toEqualTypeOf<1.5>();
  });
});
