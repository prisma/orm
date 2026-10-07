import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { type MongoQueryExecutor, mongoOrm } from '@internal/mongo-orm';
import { buildMongoEnums } from '@internal/mongo-runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import mongoStatic from '../src/static/mongo-static';

const launch = '2024-01-01T00:00:00.000Z';
const sunset = '2025-06-30T12:00:00.000Z';

const TextLevel = enumType(
  'TextLevel',
  { codecId: 'mongo/string@1', nativeType: 'string' },
  member('Low', 'low'),
  member('High', 'high'),
);
const Int32Level = enumType(
  'Int32Level',
  { codecId: 'mongo/int32@1', nativeType: 'int' },
  member('Low', 1),
  member('High', 10),
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
  member('Launch', new Date(launch)),
  member('Sunset', new Date(sunset)),
);
const DoubleLevel = enumType(
  'DoubleLevel',
  { codecId: 'mongo/double@1', nativeType: 'double' },
  member('Half', 1.5),
  member('Whole', 2.25),
);

const contract = defineContract({
  enums: { TextLevel, Int32Level, Int64Level, DateLevel, DoubleLevel },
  models: {
    Reading: model('Reading', {
      collection: 'readings',
      fields: {
        _id: field.objectId(),
        text: field.namedType(TextLevel),
        int32: field.namedType(Int32Level),
        int64: field.namedType(Int64Level),
        date: field.namedType(DateLevel),
        double: field.namedType(DoubleLevel),
      },
    }),
  },
});

const contractJson = new MongoContractSerializer().serializeContract(contract);
const { enums, context } = mongoStatic<typeof contract>({ contractJson });

const unreachableDatabase: MongoQueryExecutor = {
  query: () =>
    new AsyncIterableResult(
      (async function* () {
        yield* [];
        throw new Error('no database');
      })(),
    ),
  execute: async () => {
    throw new Error('no database');
  },
};

const reading = {
  text: enums.TextLevel.members.High,
  int32: enums.Int32Level.members.High,
  int64: enums.Int64Level.members.High,
  date: enums.DateLevel.members.Sunset,
  double: enums.DoubleLevel.members.Whole,
};

const isMember = (accessor: { has(value: unknown): boolean }, value: unknown) =>
  accessor.has(value);

describe('db.enums members hold the value a query returns for them', () => {
  it('holds each member as its codec reads it', () => {
    expect({
      text: enums.TextLevel.members,
      int32: enums.Int32Level.members,
      int64: enums.Int64Level.members,
      date: enums.DateLevel.members,
      double: enums.DoubleLevel.members,
    }).toEqual({
      text: { Low: 'low', High: 'high' },
      int32: { Low: 1, High: 10 },
      int64: { Low: 1n, High: 10n },
      date: { Launch: new Date(launch), Sunset: new Date(sunset) },
      double: { Half: 1.5, Whole: 2.25 },
    });
  });

  it('finds a value equal to each member, and no stored form that differs from the value', () => {
    expect({
      text: enums.TextLevel.has('high'),
      int32: enums.Int32Level.has(10),
      int64: enums.Int64Level.has(10n),
      int64Stored: isMember(enums.Int64Level, '10'),
      date: enums.DateLevel.nameOf(new Date(sunset)),
      dateStored: isMember(enums.DateLevel, sunset),
      double: enums.DoubleLevel.ordinalOf(2.25),
    }).toEqual({
      text: true,
      int32: true,
      int64: true,
      int64Stored: false,
      date: 'Sunset',
      dateStored: false,
      double: 1,
    });
  });
});

describe('db.enums member types', () => {
  it('types each member as the value it holds', () => {
    expectTypeOf(enums.TextLevel.members.Low).toEqualTypeOf<'low'>();
    expectTypeOf(enums.Int32Level.members.Low).toEqualTypeOf<1>();
    expectTypeOf(enums.Int64Level.members.Low).toEqualTypeOf<1n>();
    expectTypeOf(enums.DateLevel.members.Launch).toEqualTypeOf<Date>();
    expectTypeOf(enums.DoubleLevel.members.Half).toEqualTypeOf<1.5>();
  });
});

describe('the Mongo ORM checks a written enum value against the accessors db.enums holds', () => {
  it('passes a member to the database and refuses a value outside the enum', async () => {
    const orm = mongoOrm({
      contract,
      executor: unreachableDatabase,
      enums: buildMongoEnums(contract, context.codecs),
    });
    await expect(orm.readings.create(reading)).rejects.toThrow('no database');
    await expect(orm.readings.create({ ...reading, int64: 7n as never })).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Failed to encode field int64 in collection 'readings': 7n is not a value of enum Int64Level; the values are 1n and 10n",
    });
  });

  it('refuses a write when it was built without the accessor of the enum', async () => {
    const orm = mongoOrm({ contract, executor: unreachableDatabase, enums: {} });
    await expect(orm.readings.create(reading)).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        "The ORM has no accessor for enum TextLevel, so it cannot check the value written to text in collection 'readings'. Pass the contract's enum accessors: enums: buildMongoEnums(contract, context.codecs).",
    });
  });

  it('refuses a contract whose enum codec the runtime lacks when the accessors are built', () => {
    expect(() => buildMongoEnums(contract, { get: () => undefined, has: () => false })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        message:
          "No codec is registered for codecId 'mongo/string@1', which a domain enum in the contract uses.",
      }),
    );
  });
});
