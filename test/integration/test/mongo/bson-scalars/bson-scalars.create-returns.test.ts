import { BSONRegExp, Double, Int32, Long } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

function post(tag: number) {
  return {
    views: BigInt(tag),
    price: '1.50',
    thumbnail: new Uint8Array([tag]),
    meta: { tag },
    raw: {
      smallLong: Long.fromNumber(5),
      wholeDouble: new Double(2),
      int: new Int32(7),
      pattern: new BSONRegExp('x.y', 'm'),
      bytes: new Uint8Array([9, 9]),
    },
  };
}

describe('Mongo create return values', () => {
  it(
    'are the stored document as a read returns it',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.posts.create(post(1));

        const [read] = await db.posts.where({ _id: created._id }).all();
        expect(created).toStrictEqual(read);
        expect(created.raw).toMatchObject({ smallLong: 5, wholeDouble: 2, int: 7 });
      }),
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'are the stored documents as a read returns them for createAll, in input order',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.posts.createAll([post(2), post(1)]).toArray();

        const read = await db.posts.orderBy({ views: -1 }).all();
        expect(created).toStrictEqual(read);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
