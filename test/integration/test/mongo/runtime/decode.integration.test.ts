import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { isRuntimeError } from '@internal/framework-components/runtime';
import { mongoCodec } from '@internal/mongo-codec';
import type { MongoResultShape } from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  MongoFieldFilter,
  MongoMatchStage,
  RawAggregateCommand,
} from '@internal/mongo-query-ast/execution';
import { mongoQuery } from '@internal/mongo-query-builder';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  decodeFixtureContractJson,
  type TDecodeFixtureContract,
} from './fixtures/decode-fixture-contract';
import { withMongod } from './setup';

describe('Mongo runtime decode integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  it('typed read returns decoded _id, dates, and vector array', async () => {
    await withMongod(async (ctx) => {
      const contract = new MongoContractSerializer().deserializeContract(
        decodeFixtureContractJson,
      ) as TDecodeFixtureContract;
      const createdAt = new Date('2024-01-15T12:00:00.000Z');
      const vec = [0.1, 0.2, 0.3];
      const insert = await ctx.client.db(ctx.dbName).collection('users').insertOne({
        name: 'Test',
        email: 't@example.com',
        createdAt,
        embeddings: vec,
      });

      // User-facing path: build the plan through the query-builder so the Row type is contract-derived (no explicit annotation on execute).
      const plan = mongoQuery<TDecodeFixtureContract>({ contractJson: contract })
        .from('users')
        .match((f) =>
          f['_id']!.eq(MongoParamRef.of(insert.insertedId, { codecId: 'mongo/objectId@1' })),
        )
        .build();

      const rows = await ctx.runtime.query(plan).toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(typeof row['_id']).toBe('string');
      expect(row['_id']).toBe(insert.insertedId.toHexString());
      const decodedCreatedAt = row['createdAt'];
      expect(decodedCreatedAt).toBeInstanceOf(Date);
      expect((decodedCreatedAt as Date).getTime()).toBe(createdAt.getTime());
      expect(row['embeddings']).toEqual(vec);
    });
  });

  it('decode failure surfaces RUNTIME.DECODE_FAILED with details and cause', async () => {
    await withMongod(async (ctx) => {
      // The synthetic codec id (`test/throws-on-decode@1`) is not a contract field codec, so this test legitimately needs a stub `resultShape` — the user-facing `mongoQuery(...)` path can't construct a shape referencing a codec the contract doesn't declare. The tradeoff is intentional: this test exercises the failure-envelope plumbing, not the lane-population path. The other two integration tests in this file go through the
      // query-builder.
      const failing = mongoCodec({
        typeId: 'test/throws-on-decode@1',
        encode: (v: string) => v,
        decode: () => {
          throw new Error('decode explosion');
        },
      });
      ctx.codecs.register(failing);

      const shape: MongoResultShape = {
        kind: 'document',
        fields: {
          x: { kind: 'leaf', codecId: 'test/throws-on-decode@1', nullable: false },
        },
      };
      const command = new AggregateCommand('items', [
        new MongoMatchStage(MongoFieldFilter.eq('x', 'wire')),
      ]);
      await ctx.client.db(ctx.dbName).collection('items').insertOne({ x: 'wire' });
      let err: unknown;
      try {
        for await (const _ of ctx.runtime.query({
          collection: 'items',
          command,
          meta: ctx.stubMeta,
          resultShape: shape,
        })) {
          void _;
        }
      } catch (e) {
        err = e;
      }
      expect(isRuntimeError(err)).toBe(true);
      if (!isRuntimeError(err)) return;
      expect(err.code).toBe('RUNTIME.DECODE_FAILED');
      expect(err.details).toMatchObject({
        collection: 'items',
        path: 'x',
        codec: 'test/throws-on-decode@1',
      });
      expect(err.cause).toBeInstanceOf(Error);
    });
  });

  it('names the collection and field when a Decimal128 field holds a double', async () => {
    await withMongod(async (ctx) => {
      await ctx.client.db(ctx.dbName).collection('posts').insertOne({ price: 19.99 });
      const shape: MongoResultShape = {
        kind: 'document',
        fields: {
          price: { kind: 'leaf', codecId: 'mongo/decimal128@1', nullable: false },
        },
      };
      let err: unknown;
      try {
        for await (const _ of ctx.runtime.query({
          collection: 'posts',
          command: new AggregateCommand('posts', []),
          meta: ctx.stubMeta,
          resultShape: shape,
        })) {
          void _;
        }
      } catch (e) {
        err = e;
      }
      expect(isRuntimeError(err)).toBe(true);
      if (!isRuntimeError(err)) return;
      expect({ code: err.code, message: err.message, details: err.details }).toEqual({
        code: 'RUNTIME.DECODE_FAILED',
        message:
          "Failed to decode field price in collection 'posts' with codec 'mongo/decimal128@1': mongo/decimal128@1 wire value must be a Decimal128",
        details: {
          codecId: 'mongo/decimal128@1',
          received: 'number',
          collection: 'posts',
          path: 'price',
          codec: 'mongo/decimal128@1',
          wirePreview: '19.99',
        },
      });
    });
  });

  it('raw aggregate yields rows unchanged without resultShape', async () => {
    await withMongod(async (ctx) => {
      const oid = await ctx.client.db(ctx.dbName).collection('rawt').insertOne({ a: 1 });
      const command = new RawAggregateCommand('rawt', [{ $match: { _id: oid.insertedId } }]);
      const rows = await ctx.runtime
        .query<{ _id: unknown }>({ collection: 'rawt', command, meta: ctx.stubMeta })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]!['_id']).not.toBe(oid.insertedId.toHexString());
      const ctorName = Object.getPrototypeOf(rows[0]!['_id']).constructor.name;
      expect(ctorName).toBe('ObjectId');
    });
  });

  it('unknown shape slot leaves driver value for that field intact', async () => {
    await withMongod(async (ctx) => {
      // No contract-modelled lane currently emits `kind: 'unknown'` for a sibling-of-leaf slot — lanes either emit a fully-described document shape or omit `resultShape` entirely. This test exercises the runtime's unknown-slot behavior with a hand-rolled shape; the match filter still goes through `MongoParamRef` for the encode-side codec round-trip (no `as unknown as MongoValue` cast — `MongoParamRef` is a member of
      // `MongoValue`).
      const nested = { city: 'Paris' };
      const insert = await ctx.client
        .db(ctx.dbName)
        .collection('opaque')
        .insertOne({ addr: nested });
      const shape: MongoResultShape = {
        kind: 'document',
        fields: {
          _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          addr: { kind: 'unknown' },
        },
      };
      const command = new AggregateCommand('opaque', [
        new MongoMatchStage(
          MongoFieldFilter.eq(
            '_id',
            MongoParamRef.of(insert.insertedId, { codecId: 'mongo/objectId@1' }),
          ),
        ),
      ]);
      const rows = await ctx.runtime
        .query<{ _id: string; addr: object }>({
          collection: 'opaque',
          command,
          meta: ctx.stubMeta,
          resultShape: shape,
        })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.addr).toEqual(nested);
    });
  });
});
