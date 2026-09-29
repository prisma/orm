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
});
