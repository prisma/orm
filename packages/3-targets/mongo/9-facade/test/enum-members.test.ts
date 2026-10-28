import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { createMongoCollection, type MongoQueryExecutor, mongoOrm } from '@internal/mongo-orm';
import { buildMongoEnums } from '@internal/mongo-runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import mongoStatic from '../src/static/mongo-static';

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
        _id: field.objectId(),
        text: field.namedType(TextLevel),
        int32: field.namedType(Int32Level),
        double: field.namedType(DoubleLevel),
      },
    }),
  },
});

const { enums, context } = mongoStatic({ contract });

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
  double: enums.DoubleLevel.members.Whole,
};

const isMember = (accessor: { has(value: unknown): boolean }, value: unknown) =>
  accessor.has(value);

describe('db.enums members hold the value a query returns for them', () => {
  it('holds each member as its codec reads it', () => {
    expect({
      text: enums.TextLevel.members,
      int32: enums.Int32Level.members,
      double: enums.DoubleLevel.members,
    }).toEqual({
      text: { Low: 'low', High: 'high' },
      int32: { Low: 1, High: 10 },
      double: { Half: 1.5, Whole: 2.25 },
    });
  });

  it('finds a value equal to each member, and no value of another type', () => {
    expect({
      text: enums.TextLevel.has('high'),
      int32: enums.Int32Level.has(10),
      int32AsText: isMember(enums.Int32Level, '10'),
      double: enums.DoubleLevel.ordinalOf(2.25),
      doubleName: enums.DoubleLevel.nameOf(1.5),
    }).toEqual({
      text: true,
      int32: true,
      int32AsText: false,
      double: 1,
      doubleName: 'Half',
    });
  });
});

describe('db.enums member types', () => {
  it('types each member as the value it holds', () => {
    expectTypeOf(enums.TextLevel.members.Low).toEqualTypeOf<'low'>();
    expectTypeOf(enums.Int32Level.members.Low).toEqualTypeOf<1>();
    expectTypeOf(enums.DoubleLevel.members.Half).toEqualTypeOf<1.5>();
  });
});

describe('the Mongo ORM checks a written enum value against the accessors db.enums holds', () => {
  it('passes a member to the database and refuses a value outside the enum', async () => {
    const orm = mongoOrm({
      context,
      executor: unreachableDatabase,
      enums: buildMongoEnums(contract, context.codecs),
    });
    await expect(orm.readings.create(reading)).rejects.toThrow('no database');
    await expect(orm.readings.create({ ...reading, int32: 7 as never })).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Failed to encode field int32 in collection 'readings': 7 is not a value of enum Int32Level; the values are 1 and 10",
    });
  });

  it('refuses accessors without an enum of the contract when it is built', () => {
    const { DoubleLevel: _doubleLevel, ...withoutDouble } = Object.getOwnPropertyDescriptors(
      buildMongoEnums(contract, context.codecs)['__unbound__'],
    );
    const refusalFor = (enumName: string) =>
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: `mongoOrm() has no accessor for enum ${enumName} in namespace __unbound__, so it cannot check a value written to a field of that enum. Pass the contract's enum accessors: enums: buildMongoEnums(contract, context.codecs).`,
        meta: { argument: 'enums', namespace: '__unbound__', enum: enumName },
      });
    expect(() => mongoOrm({ context, executor: unreachableDatabase, enums: {} })).toThrow(
      refusalFor('TextLevel'),
    );
    expect(() =>
      mongoOrm({
        context,
        executor: unreachableDatabase,
        enums: { __unbound__: Object.defineProperties({}, withoutDouble) },
      }),
    ).toThrow(refusalFor('DoubleLevel'));
  });

  it('does not read an accessor when it is built', () => {
    const unread = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.keys(contract.domain.namespaces['__unbound__']?.enum ?? {}).map((name) => [
          name,
          {
            enumerable: true,
            get: () => {
              throw new Error(`read ${name}`);
            },
          },
        ]),
      ),
    );
    expect(() =>
      mongoOrm({ context, executor: unreachableDatabase, enums: { __unbound__: unread } }),
    ).not.toThrow();
  });

  it('refuses a collection write when the collection was built without the accessor of the enum', async () => {
    const readings = createMongoCollection(contract, 'Reading', unreachableDatabase, {});
    await expect(readings.create(reading)).rejects.toMatchObject({
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
