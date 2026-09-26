/**
 * End-to-end test for the user-facing path: contract types →
 * `mongoQuery(...).from(...).<chain>.build()` → `runtime.query(plan)` →
 * decoded rows.
 *
 * This file is the single artifact tying contract type inference, lane
 * shape derivation, and runtime decode behaviour together. The other
 * runtime tests cover individual layers (decoder unit, runtime middleware,
 * abort plumbing); this one is the integration view of "what the user
 * sees from a typed contract" and checks both type-level inferences (via
 * `expectTypeOf`) and runtime values.
 */

import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { acc, mongoQuery } from '@internal/mongo-query-builder';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  decodeFixtureContractJson,
  type TDecodeFixtureContract,
} from './fixtures/decode-fixture-contract';
import { withMongod } from './setup';

const q = mongoQuery<TDecodeFixtureContract>({ contractJson: decodeFixtureContractJson });

describe('Mongo runtime decode integration via query-builder', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  it('typed read: contract → query-builder → runtime decode end-to-end', async () => {
    await withMongod(async (ctx) => {
      const contract = new MongoContractSerializer().deserializeContract(
        decodeFixtureContractJson,
      ) as TDecodeFixtureContract;
      const createdAt = new Date('2024-04-15T12:00:00.000Z');
      const vec = [0.1, 0.2, 0.3];
      const insert = await ctx.client.db(ctx.dbName).collection('users').insertOne({
        name: 'Alice',
        email: 'alice@example.com',
        createdAt,
        embeddings: vec,
      });

      const plan = mongoQuery<TDecodeFixtureContract>({ contractJson: contract })
        .from('users')
        .match((f) =>
          f['_id']!.eq(MongoParamRef.of(insert.insertedId, { codecId: 'mongo/objectId@1' })),
        )
        .build();

      // Type-level: row inferred from contract codec types. The output
      // types come from `DecodeFixtureCodecTypes` (objectId → string,
      // date → Date, vector → readonly number[]).
      type Row = typeof plan extends { readonly _row?: infer R } ? R : never;
      expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
      expectTypeOf<Row['name']>().toEqualTypeOf<string>();
      expectTypeOf<Row['email']>().toEqualTypeOf<string>();
      expectTypeOf<Row['createdAt']>().toEqualTypeOf<Date>();
      // `embeddings` is a `mongo/vector@1` field; the codec emits a
      // `readonly number[]`, which is what the contract codec-types
      // declare, so the row type matches.
      expectTypeOf<Row['embeddings']>().toEqualTypeOf<readonly number[]>();

      const rows = await ctx.runtime.query(plan).toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(typeof row['_id']).toBe('string');
      expect(row['_id']).toBe(insert.insertedId.toHexString());
      expect(row['name']).toBe('Alice');
      const decodedCreatedAt = row['createdAt'];
      expect(decodedCreatedAt).toBeInstanceOf(Date);
      expect((decodedCreatedAt as Date).getTime()).toBe(createdAt.getTime());
      expect(row['embeddings']).toEqual(vec);
    });
  });

  it('project narrows the row type at compile time; runtime decodes the projected keys', async () => {
    await withMongod(async (ctx) => {
      const createdAt = new Date('2024-05-01T00:00:00.000Z');
      await ctx.client
        .db(ctx.dbName)
        .collection('users')
        .insertOne({
          name: 'Bob',
          email: 'bob@example.com',
          createdAt,
          embeddings: [1, 2, 3],
        });

      const plan = q.from('users').project('_id', 'name').build();

      // `$project` with a key-list (all-`1`) projection is reified by the
      // lane: `_id` (implicitly retained) and `name` both trace to model
      // fields, so the runtime decodes them per their codecs.
      expect(plan.resultShape).toEqual({
        kind: 'document',
        fields: {
          _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      });
      const rows = await ctx.runtime.query(plan).toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0] as Record<string, unknown>;
      expect(Object.keys(row).sort()).toEqual(['_id', 'name']);
      expect(typeof row['_id']).toBe('string');
      expect(row['name']).toBe('Bob');
    });
  });

  it('shape-rewriting pipeline ($group) emits kind: unknown — no decode at the boundary', async () => {
    await withMongod(async (ctx) => {
      const oid1 = new ObjectId();
      const oid2 = new ObjectId();
      // Two posts authored by oid1, one by oid2.
      await ctx.client
        .db(ctx.dbName)
        .collection('posts')
        .insertMany([
          { _id: new ObjectId(), title: 'a', userId: oid1 },
          { _id: new ObjectId(), title: 'b', userId: oid1 },
          { _id: new ObjectId(), title: 'c', userId: oid2 },
        ]);

      const plan = q
        .from('posts')
        .group((f) => ({
          _id: f['userId']!,
          count: acc.count(),
        }))
        .build();

      // Lane emits `resultShape: { kind: 'unknown' }` for shape-rewriting
      // pipelines so the runtime passes rows through unchanged.
      expect(plan.resultShape).toEqual({ kind: 'unknown' });

      const rows = await ctx.runtime.query(plan).toArray();
      expect(rows).toHaveLength(2);
      // No decode at the boundary: `_id` from `$group` is the raw wire
      // value (an `ObjectId`, since we grouped by `userId`). The runtime
      // returns these unchanged because the resultShape is `unknown`.
      for (const row of rows as Array<{ _id: unknown; count: number }>) {
        expect(Object.getPrototypeOf(row._id).constructor.name).toBe('ObjectId');
        expect(typeof row.count).toBe('number');
      }
      const sortedCounts = (rows as Array<{ count: number }>).map((r) => r.count).sort();
      expect(sortedCounts).toEqual([1, 2]);
    });
  });

  it('lookup adds a relation array as kind: unknown — relation rows pass through', async () => {
    await withMongod(async (ctx) => {
      const userId = new ObjectId();
      const userCreatedAt = new Date('2024-06-01T00:00:00.000Z');
      await ctx.client.db(ctx.dbName).collection('users').insertOne({
        _id: userId,
        name: 'Carol',
        email: 'carol@example.com',
        createdAt: userCreatedAt,
        embeddings: [],
      });
      await ctx.client
        .db(ctx.dbName)
        .collection('posts')
        .insertMany([
          { _id: new ObjectId(), title: 'p1', userId },
          { _id: new ObjectId(), title: 'p2', userId },
        ]);

      const plan = q
        .from('users')
        .lookup((from) =>
          from('posts')
            .on((local, foreign) => ({
              local: local['_id']!,
              foreign: foreign['userId']!,
            }))
            .as('posts'),
        )
        .match((f) => f['_id']!.eq(MongoParamRef.of(userId, { codecId: 'mongo/objectId@1' })))
        .build();

      // Lookup is a shape-rewriting stage as far as the lane is concerned
      // (the contract User model has no `posts` field), so lanes emit
      // `kind: 'unknown'` for the whole pipeline. The runtime yields rows
      // verbatim — `_id` stays an ObjectId, `posts` stays an array of
      // raw documents. This makes the deferred lane work for relations
      // visible: when lanes thread concrete relation shapes, only the
      // `posts` slot will need a structural shape; the rest passes
      // through additively.
      expect(plan.resultShape).toEqual({ kind: 'unknown' });

      const rows = await ctx.runtime.query(plan).toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0] as { _id: unknown; name: unknown; posts: unknown[] };
      expect(Object.getPrototypeOf(row._id).constructor.name).toBe('ObjectId');
      expect(row.name).toBe('Carol');
      expect(Array.isArray(row.posts)).toBe(true);
      expect(row.posts).toHaveLength(2);
      const titles = (row.posts as Array<{ title: string }>).map((p) => p.title).sort();
      expect(titles).toEqual(['p1', 'p2']);
    });
  });
});
