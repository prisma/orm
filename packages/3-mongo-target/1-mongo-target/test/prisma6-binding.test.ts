import { describe, expect, it } from 'vitest';
import { prisma6MongoBinding } from '../src/core/prisma6-binding';

describe('prisma6MongoBinding', () => {
  it('reads the mongodb provider for the Mongo target', () => {
    expect(prisma6MongoBinding.providers).toEqual(['mongodb']);
    expect(prisma6MongoBinding.target).toMatchObject({ familyId: 'mongo', targetId: 'mongo' });
  });

  it('maps each Prisma 6 scalar to the codec for the BSON type Prisma 6 stores it as', () => {
    expect(prisma6MongoBinding.scalarCodecIds).toEqual({
      String: 'mongo/string@1',
      Int: 'mongo/int64@1',
      Float: 'mongo/double@1',
      Boolean: 'mongo/bool@1',
      DateTime: 'mongo/date@1',
      BigInt: 'mongo/int64@1',
      Decimal: 'mongo/decimal128@1',
      Bytes: 'mongo/binary@1',
      Json: 'mongo/json@1',
    });
  });

  it('maps each native type Prisma 6 accepts to the codec for the BSON type it stores', () => {
    expect(prisma6MongoBinding.nativeTypeCodecIds).toEqual({
      String: { 'db.String': 'mongo/string@1', 'db.ObjectId': 'mongo/objectId@1' },
      Boolean: { 'db.Bool': 'mongo/bool@1' },
      Int: { 'db.Int': 'mongo/int32@1', 'db.Long': 'mongo/int64@1' },
      BigInt: { 'db.Long': 'mongo/int64@1' },
      Float: { 'db.Double': 'mongo/double@1' },
      DateTime: { 'db.Date': 'mongo/date@1' },
      Bytes: { 'db.BinData': 'mongo/binary@1', 'db.ObjectId': 'mongo/objectId@1' },
      Json: { 'db.Json': 'mongo/json@1' },
    });
  });

  it('names the ObjectId codec and the timestamp generator', () => {
    expect(prisma6MongoBinding.objectIdCodecId).toBe('mongo/objectId@1');
    expect(prisma6MongoBinding.timestampGeneratorId).toBe('timestampNow');
  });
});
