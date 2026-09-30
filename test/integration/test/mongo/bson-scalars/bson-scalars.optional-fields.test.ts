import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { Decimal128, Long, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const authorId = new ObjectId('65f0000000000000000000c1');

describe('Mongo optional fields a stored document leaves out', () => {
  it(
    'read as null, as their types say',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await mongoDb.collection('authors').insertOne({
          _id: authorId,
          karma: Long.fromNumber(1),
          balance: Decimal128.fromString('0'),
          role: 'USER',
        });

        const [author] = await db.authors.select('_id', 'karma', 'avatar').all();
        expect(author).toStrictEqual({ _id: authorId.toHexString(), karma: 1n, avatar: null });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'accept null or no value at all on create, and store null only when given',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await db.authors.create({ karma: 1n, balance: '1', role: 'USER', avatar: null });
        await db.authors.create({ karma: 2n, balance: '2', role: 'USER' });

        const stored = await mongoDb
          .collection('authors')
          .find({}, { projection: { _id: 0, karma: 1, avatar: 1, address: 1 } })
          .sort({ karma: 1 })
          .toArray();
        expect(
          stored.map((document) => ({ ...document, karma: String(document['karma']) })),
        ).toEqual([{ karma: '1', avatar: null }, { karma: '2' }]);
        expect(
          (await db.authors.orderBy({ karma: 1 }).all()).map(({ avatar, address }) => ({
            avatar,
            address,
          })),
        ).toEqual([
          { avatar: null, address: null },
          { avatar: null, address: null },
        ]);
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'refuse null for a required field on write, naming it, and still filter by null',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, mongoDb }) => {
        await expect(
          db.authors.create({ karma: null as unknown as bigint, balance: '1', role: 'USER' }),
        ).rejects.toMatchObject({
          code: 'RUNTIME.ENCODE_FAILED',
          message:
            "Failed to encode field karma in collection 'authors': the field is required and cannot be null",
          details: { label: 'karma', collection: 'authors' },
        });
        await expect(
          db.authors.create({ karma: 1n, balance: '1', role: null as unknown as 'USER' }),
        ).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED', details: { label: 'role' } });
        expect(await mongoDb.collection('authors').countDocuments()).toBe(0);

        await db.authors.create({ karma: 1n, balance: '1', role: 'USER', avatar: null });
        expect(await db.authors.where(MongoFieldFilter.eq('avatar', null)).all()).toHaveLength(1);
        expect(await db.authors.where({ karma: null as unknown as bigint }).all()).toHaveLength(0);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
