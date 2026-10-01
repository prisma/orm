import { Long } from 'bson';
import { describe, expect, it } from 'vitest';
import {
  buildStandardCodecRegistry,
  mongoCodecDescriptors,
  mongoDescriptorById,
} from '../src/core/codecs';
import { prisma6MongoBinding } from '../src/core/prisma6-binding';

/**
 * The BSON type the Prisma 6.19.3 client stored for each scalar type and each native type it accepts on MongoDB, read back with `$type`. `prisma validate` accepts no other native type on MongoDB.
 */
const PRISMA6_STORED_BSON: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  String: { '': 'string', 'db.String': 'string', 'db.ObjectId': 'objectId' },
  Boolean: { '': 'bool', 'db.Bool': 'bool' },
  Int: { '': 'long', 'db.Int': 'int', 'db.Long': 'long' },
  BigInt: { '': 'long', 'db.Long': 'long' },
  Float: { '': 'double', 'db.Double': 'double' },
  DateTime: { '': 'date', 'db.Date': 'date', 'db.Timestamp': 'timestamp' },
  Bytes: { '': 'binData', 'db.BinData': 'binData', 'db.ObjectId': 'objectId' },
  Json: { '': 'object', 'db.Json': 'object' },
};

const observed = Object.entries(PRISMA6_STORED_BSON).flatMap(([typeName, byNativeType]) =>
  Object.entries(byNativeType).map(([nativeType, bson]) => ({
    field: nativeType === '' ? typeName : `${typeName} @${nativeType}`,
    typeName,
    nativeType,
    bson,
  })),
);

function codecFor(typeName: string, nativeType: string): string | undefined {
  const scalars: Readonly<Record<string, string>> = prisma6MongoBinding.scalarCodecIds;
  const nativeTypes: Readonly<Record<string, Readonly<Record<string, string>>>> =
    prisma6MongoBinding.nativeTypeCodecIds;
  const table = nativeType === '' ? scalars : nativeTypes[typeName];
  const key = nativeType === '' ? typeName : nativeType;
  return table !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

function codecsReading(bson: string): readonly string[] {
  return mongoCodecDescriptors
    .filter((descriptor) => descriptor.targetTypes.includes(bson))
    .map((descriptor) => descriptor.codecId);
}

describe('prisma6MongoBinding', () => {
  it.each(observed.filter(({ bson }) => codecsReading(bson).length > 0))(
    'gives $field a codec for the BSON $bson Prisma 6 stores',
    ({ typeName, nativeType, bson }) => {
      const codecId = codecFor(typeName, nativeType);

      expect(codecId === undefined ? [] : mongoDescriptorById(codecId)?.targetTypes).toContain(
        bson,
      );
    },
  );

  it.each(observed.filter(({ bson }) => codecsReading(bson).length === 0))(
    'has no codec for $field, whose BSON $bson no Mongo codec reads',
    ({ typeName, nativeType }) => {
      expect(codecFor(typeName, nativeType)).toBeUndefined();
    },
  );

  it.each([
    { field: 'Int', typeName: 'Int', nativeType: '', wire: Long.fromNumber(5), type: 'number' },
    {
      field: 'Int @db.Long',
      typeName: 'Int',
      nativeType: 'db.Long',
      wire: Long.fromNumber(5),
      type: 'number',
    },
    { field: 'Int @db.Int', typeName: 'Int', nativeType: 'db.Int', wire: 5, type: 'number' },
    {
      field: 'BigInt',
      typeName: 'BigInt',
      nativeType: '',
      wire: Long.fromNumber(5),
      type: 'bigint',
    },
    {
      field: 'BigInt @db.Long',
      typeName: 'BigInt',
      nativeType: 'db.Long',
      wire: Long.fromNumber(5),
      type: 'bigint',
    },
  ])(
    'reads $field as the $type the Prisma 6 client presents',
    async ({ typeName, nativeType, wire, type }) => {
      const codecId = codecFor(typeName, nativeType);
      const codec = codecId === undefined ? undefined : buildStandardCodecRegistry().get(codecId);

      expect(typeof (await codec?.decode(wire, {}))).toBe(type);
    },
  );

  it('gives an @id the codec for the ObjectId Prisma 6 stores in _id', () => {
    expect(mongoDescriptorById(prisma6MongoBinding.objectIdCodecId)?.targetTypes).toContain(
      'objectId',
    );
  });
});
