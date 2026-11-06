import { type DataTypeValue, dataType, readJsonString } from '@internal/framework-components/codec';
import { mongoCodec, mongoCodecDescriptor } from '@internal/mongo-codec';
import {
  AggregateCommand,
  InsertOneCommand,
  MongoAddFieldsStage,
  MongoAggLiteral,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoSkipStage,
  MongoSortStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import type { MongoMiddleware, MongoRuntimeExtensionDescriptor } from '@internal/mongo-runtime';
import { MongoParamRef } from '@internal/mongo-value';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { type MongodContext, withMongod } from './setup';

const users = 'prepared_users';

async function seedUsers(ctx: MongodContext): Promise<ObjectId> {
  const db = ctx.client.db(ctx.dbName);
  const { insertedIds } = await db.collection(users).insertMany([
    { name: 'ALICE', email: 'alice@example.com', nickname: null, age: 30, status: 'active' },
    { name: 'BOB', email: 'bob@example.com', nickname: 'bobby', age: 25, status: 'active' },
    { name: 'CAROL', email: 'carol@example.com', age: 41, status: 'new' },
  ]);
  await db.collection('prepared_posts').insertMany([
    { author: 'ALICE', title: 'one' },
    { author: 'ALICE', title: 'two' },
    { author: 'ALICE', title: 'three' },
  ]);
  return insertedIds[0] ?? new ObjectId();
}

const textType = dataType('test/text', { read: (json) => readJsonString('test/text', json) });

const upperCodecExtension: MongoRuntimeExtensionDescriptor = {
  kind: 'extension',
  id: 'test-upper-codec',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  types: {
    codecTypes: {
      codecDescriptors: [
        mongoCodecDescriptor(
          mongoCodec({
            typeId: 'test/upper@1',
            fromWire: (wire: string) => wire,
            toWire: (value: string) => value.toUpperCase(),
            dataType: textType,
            fromDataTypeValue: (value: DataTypeValue<string>) => value.value,
          }),
          { traits: [] },
        ),
      ],
    },
  },
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};

function field(row: unknown, key: string): unknown {
  return typeof row === 'object' && row !== null ? Reflect.get(row, key) : undefined;
}

function names(rows: ReadonlyArray<unknown>): unknown[] {
  return rows.map((row) => field(row, 'name'));
}

describe('runtime.prepare', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  it('runs prepared reads with values encoded by the declared codecs', async () => {
    await withMongod(async (ctx) => {
      const aliceId = await seedUsers(ctx);
      const { runtime, stubMeta } = ctx;

      const byEmail = await runtime.prepare({ email: 'mongo/string@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
        ]),
        meta: stubMeta,
      }));
      expect(names(await byEmail.query(runtime, { email: 'alice@example.com' }).toArray())).toEqual(
        ['ALICE'],
      );
      expect(names(await byEmail.query(runtime, { email: 'bob@example.com' }).toArray())).toEqual([
        'BOB',
      ]);

      const byId = await runtime.prepare({ id: 'mongo/objectId@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.eq('_id', p.id)),
        ]),
        meta: stubMeta,
      }));
      expect(names(await byId.query(runtime, { id: aliceId.toHexString() }).toArray())).toEqual([
        'ALICE',
      ]);

      const byEither = await runtime.prepare({ a: 'mongo/string@1', b: 'mongo/string@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.in('name', [p.a, p.b])),
          new MongoSortStage({ name: 1 }),
        ]),
        meta: stubMeta,
      }));
      expect(names(await byEither.query(runtime, { a: 'CAROL', b: 'ALICE' }).toArray())).toEqual([
        'ALICE',
        'CAROL',
      ]);

      const olderThanTwice = await runtime.prepare({ age: 'mongo/int32@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.gte('age', p.age)),
          new MongoMatchStage(MongoFieldFilter.neq('age', p.age)),
          new MongoSortStage({ age: 1 }),
        ]),
        meta: stubMeta,
      }));
      expect(names(await olderThanTwice.query(runtime, { age: 30 }).toArray())).toEqual(['CAROL']);
    });
  });

  it('sends null for a nullable parameter and refuses null for a non-nullable one', async () => {
    await withMongod(async (ctx) => {
      await seedUsers(ctx);
      const { runtime, stubMeta } = ctx;

      const byNickname = await runtime.prepare(
        { nickname: { codecId: 'mongo/string@1', nullable: true } },
        (p) => ({
          collection: users,
          command: new AggregateCommand(users, [
            new MongoMatchStage(MongoFieldFilter.eq('nickname', p.nickname)),
            new MongoSortStage({ name: 1 }),
          ]),
          meta: stubMeta,
        }),
      );
      expect(names(await byNickname.query(runtime, { nickname: null }).toArray())).toEqual([
        'ALICE',
        'CAROL',
      ]);

      const byEmail = await runtime.prepare({ email: 'mongo/string@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
        ]),
        meta: stubMeta,
      }));
      await expect(
        byEmail.query(runtime, { email: null as unknown as string }).toArray(),
      ).rejects.toMatchObject({ code: 'RUNTIME.ENCODE_FAILED' });
    });
  });

  it('encodes with an extension codec', async () => {
    await withMongod(
      async (ctx) => {
        await seedUsers(ctx);
        const byName = await ctx.runtime.prepare({ name: 'test/upper@1' }, (p) => ({
          collection: users,
          command: new AggregateCommand(users, [
            new MongoMatchStage(MongoFieldFilter.eq('name', p.name)),
          ]),
          meta: ctx.stubMeta,
        }));
        expect(names(await byName.query(ctx.runtime, { name: 'bob' }).toArray())).toEqual(['BOB']);
      },
      { extensions: [upperCodecExtension] },
    );
  });

  it('fills in limit and skip, including in a $lookup sub-pipeline, and wraps literals', async () => {
    await withMongod(async (ctx) => {
      await seedUsers(ctx);
      const { runtime, stubMeta } = ctx;

      const page = await runtime.prepare({ skip: 'mongo/int32@1', take: 'mongo/int32@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoSortStage({ name: 1 }),
          new MongoSkipStage(p.skip),
          new MongoLimitStage(p.take),
        ]),
        meta: stubMeta,
      }));
      expect(names(await page.query(runtime, { skip: 1, take: 1 }).toArray())).toEqual(['BOB']);
      expect(names(await page.query(runtime, { skip: 0, take: 2 }).toArray())).toEqual([
        'ALICE',
        'BOB',
      ]);
      await expect(page.query(runtime, { skip: -1, take: 1 }).toArray()).rejects.toMatchObject({
        code: 'ORM.ARGUMENT_INVALID',
      });

      const withPosts = await runtime.prepare(
        { name: 'mongo/string@1', take: 'mongo/int32@1' },
        (p) => ({
          collection: users,
          command: new AggregateCommand(users, [
            new MongoMatchStage(MongoFieldFilter.eq('name', p.name)),
            new MongoLookupStage({
              from: 'prepared_posts',
              localField: 'name',
              foreignField: 'author',
              as: 'posts',
              pipeline: [new MongoSortStage({ title: 1 }), new MongoLimitStage(p.take)],
            }),
          ]),
          meta: stubMeta,
        }),
      );
      const [alice] = await withPosts.query(runtime, { name: 'ALICE', take: 2 }).toArray();
      expect(field(alice, 'posts')).toHaveLength(2);

      const labelled = await runtime.prepare({ label: 'mongo/string@1' }, (p) => ({
        collection: users,
        command: new AggregateCommand(users, [
          new MongoMatchStage(MongoFieldFilter.eq('name', 'BOB')),
          new MongoAddFieldsStage({ label: MongoAggLiteral.of(p.label) }),
        ]),
        meta: stubMeta,
      }));
      const [bob] = await labelled.query(runtime, { label: '$notAFieldPath' }).toArray();
      expect(field(bob, 'label')).toBe('$notAFieldPath');
    });
  });

  it('runs prepared writes: an insert document, an update operator and an update pipeline', async () => {
    await withMongod(async (ctx) => {
      await seedUsers(ctx);
      const { runtime, stubMeta } = ctx;
      const collection = ctx.client.db(ctx.dbName).collection(users);

      const insert = await runtime.prepare({ name: 'mongo/string@1' }, (p) => ({
        collection: users,
        command: new InsertOneCommand(users, { name: p.name, status: 'new' }),
        meta: stubMeta,
      }));
      await insert.query(runtime, { name: 'DAVE' }).toArray();
      expect(await collection.countDocuments({ name: 'DAVE' })).toBe(1);

      const archive = await runtime.prepare(
        { from: 'mongo/string@1', to: 'mongo/string@1' },
        (p) => ({
          collection: users,
          command: new UpdateManyCommand(users, MongoFieldFilter.eq('status', p.from), {
            $set: { status: p.to },
          }),
          meta: stubMeta,
        }),
      );
      await expect(archive.execute(runtime, { from: 'new', to: 'archived' })).resolves.toEqual({
        affectedRows: 2,
      });

      const relabel = await runtime.prepare(
        { name: 'mongo/string@1', label: 'mongo/string@1' },
        (p) => ({
          collection: users,
          command: new UpdateOneCommand(users, MongoFieldFilter.eq('name', p.name), [
            new MongoAddFieldsStage({ label: MongoAggLiteral.of(p.label) }),
          ]),
          meta: stubMeta,
        }),
      );
      await expect(relabel.execute(runtime, { name: 'ALICE', label: 'vip' })).resolves.toEqual({
        affectedRows: 1,
      });
      expect(await collection.findOne({ name: 'ALICE' })).toMatchObject({ label: 'vip' });
    });
  });

  it('gives a prepared run the content hash of the same query run ad hoc', async () => {
    const hashes: string[] = [];
    const hasher: MongoMiddleware = {
      name: 'hasher',
      intercept: {
        async onQuery(plan, mwCtx) {
          hashes.push(await mwCtx.contentHash(plan));
          return undefined;
        },
      },
    };
    await withMongod(
      async (ctx) => {
        await seedUsers(ctx);
        const { runtime } = ctx;
        const match = (value: Parameters<typeof MongoFieldFilter.eq>[1]) => ({
          collection: users,
          command: new AggregateCommand(users, [
            new MongoMatchStage(MongoFieldFilter.eq('email', value)),
          ]),
          meta: ctx.stubMeta,
        });

        const byEmail = await runtime.prepare({ email: 'mongo/string@1' }, (p) => match(p.email));
        await byEmail.query(runtime, { email: 'alice@example.com' }).toArray();
        await runtime
          .query(match(new MongoParamRef('alice@example.com', { codecId: 'mongo/string@1' })))
          .toArray();
        await byEmail.query(runtime, { email: 'bob@example.com' }).toArray();

        expect(hashes).toHaveLength(3);
        expect(hashes[0]).toBe(hashes[1]);
        expect(hashes[2]).not.toBe(hashes[0]);
      },
      { middleware: [hasher] },
    );
  });
});
