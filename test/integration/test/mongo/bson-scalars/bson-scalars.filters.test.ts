import {
  MongoFieldFilter,
  type MongoFilterExpr,
  MongoOrExpr,
} from '@internal/mongo-query-ast/execution';
import { Decimal128, Long, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../../_harness/mongo';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const objectId = new ObjectId('65f000000000000000000009');
const long = Long.fromNumber(5);
const decimal = Decimal128.fromString('1.5');

describe('Mongo where filters on a Bson field', () => {
  it(
    'match stored ObjectId, Long and Decimal128 values given as driver classes',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db }) => {
        const post = { views: 1n, price: '1', thumbnail: new Uint8Array([1]), meta: {} };
        for (const raw of [objectId, long, decimal]) {
          await db.posts.create({ ...post, raw });
        }
        await db.posts.create({ ...post, raw: 'other' });

        const count = async (filter: MongoFilterExpr) =>
          (await db.posts.where(filter).all()).length;

        expect({
          objectId: await count(MongoFieldFilter.eq('raw', objectId as never)),
          long: await count(MongoFieldFilter.eq('raw', long as never)),
          decimal: await count(MongoFieldFilter.eq('raw', decimal as never)),
          in: await count(MongoFieldFilter.in('raw', [objectId, decimal] as never)),
          nested: await count(
            MongoOrExpr.of([
              MongoFieldFilter.eq('raw', objectId as never),
              MongoFieldFilter.eq('raw', long as never),
            ]),
          ),
          object: (await db.posts.where({ raw: objectId }).all()).length,
        }).toEqual({ objectId: 1, long: 1, decimal: 1, in: 2, nested: 2, object: 1 });
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
