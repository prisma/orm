import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { createMongoCollection, type MongoQueryExecutor, mongoOrm } from '@internal/mongo-orm';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
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
    Note: model('Note', {
      collection: 'notes',
      fields: { _id: field.objectId(), level: field.namedType(TextLevel) },
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

describe('the Mongo ORM checks a written enum value against the enums of its context', () => {
  it('passes a member to the database and refuses a value outside the enum', async () => {
    const orm = mongoOrm({ context, runtime: unreachableDatabase });
    await expect(orm.readings.create(reading)).rejects.toThrow('no database');
    await expect(orm.readings.create({ ...reading, int32: 7 as never })).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
      message:
        "Failed to encode field int32 in collection 'readings': 7 is not a value of enum Int32Level; the values are 1 and 10",
    });
  });

  it('refuses a value outside the enum written through a collection', async () => {
    const readings = createMongoCollection({ context, runtime: unreachableDatabase }, 'Reading');
    await expect(readings.create({ ...reading, text: 'medium' as never })).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
  });

  it('builds db.enums once, so every read returns the same accessor', () => {
    const db = mongoStatic({ contract });
    expect(db.enums.Int32Level).toBe(db.enums.Int32Level);
    expect(db.enums.Int32Level).not.toBe(enums.Int32Level);
  });

  it('builds its own accessors once per ORM client, which hold the values db.enums holds', async () => {
    const codecLookups = vi.fn((codecId: string) => context.codecs.get(codecId));
    const countingContext = { ...context, codecs: { ...context.codecs, get: codecLookups } };

    const orm = mongoOrm({ context: countingContext, runtime: unreachableDatabase });

    expect(codecLookups).toHaveBeenCalledTimes(Object.keys(enums).length);
    await expect(orm.readings.create(reading)).rejects.toThrow('no database');
    await expect(orm.notes.create({ level: enums.TextLevel.members.Low })).rejects.toThrow(
      'no database',
    );
    await expect(orm.notes.create({ level: 'medium' as never })).rejects.toMatchObject({
      code: 'RUNTIME.ENCODE_FAILED',
    });
  });

  it('refuses to build an ORM client whose context has no codec for an enum', () => {
    expect(() =>
      mongoOrm({
        context: { ...context, codecs: { get: () => undefined, has: () => false } },
        runtime: unreachableDatabase,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
        message:
          "No codec is registered for codecId 'mongo/string@1', which a domain enum in the contract uses.",
      }),
    );
  });
});
