import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const ownerId = '64b7f0c2a1b2c3d4e5f60718';

describe('Mongo fields declared only on a variant', () => {
  it(
    "write and read through the variant field's codec",
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.assets.variant('Photo').create({
          ownerId,
          exif: { iso: 100 },
          stamps: [{ note: 'first' }],
        });

        const stored = await mongoDb.collection('assets').findOne({});
        expect(stored?.['ownerId']).toBeInstanceOf(ObjectId);

        const rows = await db.assets.variant('Photo').all().toArray();
        expect(
          rows.map(({ kind, ownerId, exif, stamps }) => ({ kind, ownerId, exif, stamps })),
        ).toEqual([{ kind: 'photo', ownerId, exif: { iso: 100 }, stamps: [{ note: 'first' }] }]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuse a non-JSON value in a Json field on write, naming the field and the path inside it',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.assets.variant('Photo').create({
            ownerId,
            exif: { at: new Date(0) } as never,
            stamps: [],
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field exif in collection 'assets' with codec 'mongo/json@1': mongo/json@1 value must be a JSON value; received Date at at",
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'name a list element of a value object by its index when its field refuses a value',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.assets.variant('Photo').create({
            ownerId,
            exif: {},
            stamps: [{ note: 'ok' }, { note: { at: new Date(0) } as never }],
          }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field stamps.1.note in collection 'assets' with codec 'mongo/json@1': mongo/json@1 value must be a JSON value; received Date at at",
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuse a stored non-JSON value in a Json field on read, naming its path',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('assets').insertOne({
          kind: 'photo',
          ownerId: new ObjectId(ownerId),
          exif: { list: [new Date(0)] },
          stamps: [],
        });

        await expect(db.assets.variant('Photo').all().toArray()).rejects.toMatchObject({
          code: 'RUNTIME.DECODE_FAILED',
          details: { collection: 'assets', path: 'exif', valuePath: 'list.0' },
        });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
