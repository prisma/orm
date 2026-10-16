import mongo from '@prisma/orm-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contract } from '../src/db';

const mongoDb = mongo({ contract });

const q = mongoDb.query;

describe('query-builder write terminals (integration)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const dbName = 'qb_writes_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    await mongoDb.connect({ uri: replSet.getUri(), dbName });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([mongoDb.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  const db = () => client.db(dbName);
  const usersCol = () => db().collection('users');

  async function seed(...docs: Array<Record<string, unknown>>) {
    if (docs.length > 0) {
      await usersCol().insertMany(docs);
    }
  }

  // ── M2: basic CRUD ───────────────────────────────────────────────────

  describe('M2: basic CRUD', () => {
    it('insertOne + read back', async () => {
      const plan = q.from('users').insertOne({
        name: 'Alice',
        email: 'alice@example.com',
        bio: null,
        address: null,
      });
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);

      const all = await usersCol().find().toArray();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    });

    it('match → updateMany + verify', async () => {
      await seed(
        { name: 'Alice', email: 'a@e.com', bio: null },
        { name: 'Bob', email: 'b@e.com', bio: null },
      );
      const plan = q
        .from('users')
        .match((f) => f.bio.eq(null))
        .updateMany((f) => [f.bio.set('filled')]);
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);

      const all = await usersCol().find().toArray();
      expect(all.every((d) => d['bio'] === 'filled')).toBe(true);
    });

    it('match → deleteOne + verify', async () => {
      await seed({ name: 'Alice', email: 'a@e.com' }, { name: 'Bob', email: 'b@e.com' });
      const plan = q
        .from('users')
        .match((f) => f.name.eq('Alice'))
        .deleteOne();
      await (await mongoDb.runtime()).query(plan);

      const remaining = await usersCol().find().toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ name: 'Bob' });
    });

    it('updateAll on a small collection + verify', async () => {
      await seed(
        { name: 'Alice', email: 'a@e.com', bio: null },
        { name: 'Bob', email: 'b@e.com', bio: null },
      );
      const plan = q.from('users').updateAll((f) => [f.bio.set('all-updated')]);
      await (await mongoDb.runtime()).query(plan);

      const all = await usersCol().find().toArray();
      expect(all.every((d) => d['bio'] === 'all-updated')).toBe(true);
    });

    it('insertMany ordered + verify ids', async () => {
      const plan = q.from('users').insertMany([
        { name: 'Alice', email: 'a@e.com', bio: null, address: null },
        { name: 'Bob', email: 'b@e.com', bio: null, address: null },
      ]);
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);

      const all = await usersCol().find().toArray();
      expect(all).toHaveLength(2);
      expect(all.map((d) => d['name']).sort()).toEqual(['Alice', 'Bob']);
    });
  });

  // ── M3: find-and-modify / upserts ────────────────────────────────────

  describe('M3: find-and-modify / upserts', () => {
    it('findOneAndUpdate returns the updated doc with returnDocument=after', async () => {
      await seed({ name: 'Alice', email: 'a@e.com', bio: null });
      const plan = q
        .from('users')
        .match((f) => f.name.eq('Alice'))
        .findOneAndUpdate((f) => [f.bio.set('updated')], { returnDocument: 'after' });
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Alice', bio: 'updated' });
    });

    it('findOneAndUpdate returns the pre-image with returnDocument=before', async () => {
      await seed({ name: 'Alice', email: 'a@e.com', bio: 'original' });
      const plan = q
        .from('users')
        .match((f) => f.name.eq('Alice'))
        .findOneAndUpdate((f) => [f.bio.set('changed')], { returnDocument: 'before' });
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ bio: 'original', name: 'Alice' });

      const persisted = await usersCol().findOne({ name: 'Alice' });
      expect(persisted).toMatchObject({ bio: 'changed' });
    });

    it('findOneAndDelete returns the deleted doc', async () => {
      await seed({ name: 'Alice', email: 'a@e.com' }, { name: 'Bob', email: 'b@e.com' });
      const plan = q
        .from('users')
        .match((f) => f.name.eq('Alice'))
        .findOneAndDelete();
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ name: 'Alice' });

      const remaining = await usersCol().find().toArray();
      expect(remaining).toHaveLength(1);
    });

    it('upsertOne inserts when no match and surfaces upsertedId', async () => {
      const plan = q.from('users').upsertOne(
        (f) => f.email.eq('new@e.com'),
        (f) => [f.name.set('New User'), f.email.set('new@e.com'), f.bio.set(null)],
      );
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);
      const result = rows[0] as unknown as Record<string, unknown>;
      expect(result['upsertedCount']).toBe(1);
      expect(result['upsertedId']).toBeDefined();

      const all = await usersCol().find().toArray();
      expect(all).toHaveLength(1);
    });

    it('upsertOne updates existing without inserting', async () => {
      await seed({ name: 'Alice', email: 'a@e.com', bio: null });
      const plan = q.from('users').upsertOne(
        (f) => f.email.eq('a@e.com'),
        (f) => [f.bio.set('upserted')],
      );
      const rows = await (await mongoDb.runtime()).query(plan);
      expect(rows).toHaveLength(1);
      const result = rows[0] as unknown as Record<string, unknown>;
      expect(result['modifiedCount']).toBe(1);
      expect(result['upsertedId']).toBeUndefined();

      const all = await usersCol().find().toArray();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ bio: 'upserted' });
    });
  });

  // ── M4: pipeline-style updates / $merge / $out ───────────────────────

  describe('M4: pipeline-style updates and pipeline terminals', () => {
    it('updateMany with f.stage.set (pipeline-form)', async () => {
      await seed(
        { name: 'Alice', email: 'a@e.com', bio: null },
        { name: 'Bob', email: 'b@e.com', bio: null },
      );
      const plan = q
        .from('users')
        .match((f) => f.bio.eq(null))
        .updateMany((f) => [f.stage.set({ bio: f.name.node })]);

      await (await mongoDb.runtime()).query(plan);

      const all = await usersCol().find().sort({ name: 1 }).toArray();
      expect(all).toMatchObject([
        { name: 'Alice', bio: 'Alice' },
        { name: 'Bob', bio: 'Bob' },
      ]);
    });

    it('traditional operator updates still work end-to-end', async () => {
      await seed({ name: 'Alice', email: 'a@e.com', bio: null });
      const plan = q
        .from('users')
        .match((f) => f.name.eq('Alice'))
        .updateOne((f) => [f.bio.set('classic')]);
      await (await mongoDb.runtime()).query(plan);

      const doc = await usersCol().findOne({ name: 'Alice' });
      expect(doc).toMatchObject({ bio: 'classic' });
    });

    it('merge into a sibling collection', async () => {
      await seed({ name: 'Alice', email: 'a@e.com' });
      const plan = q.from('users').merge({ into: 'users_archive' });
      await (await mongoDb.runtime()).query(plan);

      const archived = await db().collection('users_archive').find().toArray();
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({ name: 'Alice' });
    });

    it('out to a fresh collection', async () => {
      await seed({ name: 'Alice', email: 'a@e.com' });
      const plan = q.from('users').out('users_snapshot');
      await (await mongoDb.runtime()).query(plan);

      const snapshot = await db().collection('users_snapshot').find().toArray();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toMatchObject({ name: 'Alice' });
    });
  });
});
