import mongo from '@internal/mongo/runtime';
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

  it(
    'match a driver ObjectId on a path inside a Bson field, and in the query builder',
    () =>
      withMongoPort<Contract>({ contractJson }, async ({ db, client, mongoDb }) => {
        const post = { views: 1n, price: '1', thumbnail: new Uint8Array([1]), meta: {} };
        const created = await db.posts.create({ ...post, raw: { owner: objectId, count: long } });
        await db.posts.create({ ...post, raw: { owner: new ObjectId() } });

        const facade = mongo<Contract>({
          contractJson,
          mongoClient: client,
          dbName: mongoDb.databaseName,
        });
        try {
          const runtime = await facade.runtime();
          const matched = async (filter: MongoFilterExpr) =>
            (await runtime.query(facade.query.from('posts').match(filter).build()).toArray())
              .length;

          expect({
            ormSubPath: (
              await db.posts.where(MongoFieldFilter.eq('raw.owner', objectId as never)).all()
            ).length,
            ormSubPathLong: (
              await db.posts.where(MongoFieldFilter.eq('raw.count', long as never)).all()
            ).length,
            builderId: await matched(
              MongoFieldFilter.eq('_id', new ObjectId(created._id) as never),
            ),
            builderBson: await matched(MongoFieldFilter.eq('raw.owner', objectId as never)),
          }).toEqual({ ormSubPath: 1, ormSubPathLong: 1, builderId: 1, builderBson: 1 });
        } finally {
          await facade.close();
        }
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
