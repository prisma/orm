import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { createMongoDriver } from '@internal/driver-mongo';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import type { FieldAccessor } from '../../src/field-accessor';
import { mongoOrm } from '../../src/mongo-orm';

const contract = ormContractJson as unknown as Contract;

const defaultUserData = {
  name: 'Alice',
  email: 'alice@test.com',
  loginCount: 0,
  tags: [] as string[],
  homeAddress: null,
};

function getUserId(user: Record<string, unknown>): ObjectId {
  return new ObjectId(user['_id'] as string);
}

describe('ORM ergonomics integration', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  const dbName = 'orm_ergonomics_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    runtime = createMongoRuntime({ context, driver });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  describe('write results decode through codecs (issue #577)', () => {
    it('create() returns _id as the decoded hex string a read returns', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const created = await orm.users.create(defaultUserData);
      expect(typeof created._id).toBe('string');
      const fetched = await orm.users.where({ _id: created._id as string }).first();
      expect(fetched!._id).toBe(created._id);
    });

    it('createAll() returns decoded _ids', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const rows: Record<string, unknown>[] = [];
      for await (const row of orm.users.createAll([
        defaultUserData,
        { ...defaultUserData, name: 'Bob', email: 'bob@test.com' },
      ])) {
        rows.push(row as Record<string, unknown>);
      }
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(typeof row['_id']).toBe('string');
      }
    });

    it('update() returns the document decoded like a read', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const created = await orm.users.create(defaultUserData);
      const updated = await orm.users
        .where({ _id: created._id as string })
        .update({ name: 'Renamed' });
      expect(updated).not.toBeNull();
      expect((updated as Record<string, unknown>)['_id']).toBe(created._id);
    });

    it('delete() returns the document decoded like a read', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const created = await orm.users.create(defaultUserData);
      const deleted = await orm.users.where({ _id: created._id as string }).delete();
      expect(deleted).not.toBeNull();
      expect((deleted as Record<string, unknown>)['_id']).toBe(created._id);
    });
  });

  describe('codec-aware where()', () => {
    it('retrieves document by ObjectId field using object where', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      const found = await orm.users.where({ _id: user._id as string }).first();
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });

    it('retrieves document by string field using object where', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      await orm.users.create(defaultUserData);
      const found = await orm.users.where({ name: 'Alice' }).first();
      expect(found).not.toBeNull();
      expect(found!.email).toBe('alice@test.com');
    });

    it('filters by multiple fields using object where', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      await orm.users.create(defaultUserData);
      await orm.users.create({ ...defaultUserData, name: 'Bob', email: 'bob@test.com' });
      const found = await orm.users.where({ name: 'Alice', email: 'alice@test.com' }).first();
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
    });
  });

  describe('field accessor mutations', () => {
    it('$push adds element to array field', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      const updated = await orm.users
        .where({ _id: user._id as string })
        .update((u) => [u.tags.push('admin')]);
      expect(updated).not.toBeNull();

      const oid = getUserId(user as Record<string, unknown>);
      const doc = await client.db(dbName).collection('users').findOne({ _id: oid });
      expect(doc!['tags']).toEqual(['admin']);
    });

    it('$pull removes element from array field', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create({ ...defaultUserData, tags: ['admin', 'editor'] });
      await orm.users.where({ _id: user._id as string }).update((u) => [u.tags.pull('admin')]);

      const oid = getUserId(user as Record<string, unknown>);
      const doc = await client.db(dbName).collection('users').findOne({ _id: oid });
      expect(doc!['tags']).toEqual(['editor']);
    });

    it('$inc increments numeric field', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      await orm.users.where({ _id: user._id as string }).update((u) => [u.loginCount.inc(1)]);

      const oid = getUserId(user as Record<string, unknown>);
      const doc = await client.db(dbName).collection('users').findOne({ _id: oid });
      expect(doc!['loginCount']).toBe(1);
    });

    it('dot-path $set updates nested value object field', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create({
        ...defaultUserData,
        homeAddress: { city: 'SF', country: 'US' },
      });
      await orm.users
        .where({ _id: user._id as string })
        .update((u) => [u('homeAddress.city').set('NYC')]);

      const oid = getUserId(user as Record<string, unknown>);
      const doc = await client.db(dbName).collection('users').findOne({ _id: oid });
      expect(doc!['homeAddress']).toEqual({ city: 'NYC', country: 'US' });
    });

    it('multiple operations in one callback are applied together', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      await orm.users
        .where({ _id: user._id as string })
        .update((u) => [u.tags.push('admin'), u.loginCount.inc(5)]);

      const oid = getUserId(user as Record<string, unknown>);
      const doc = await client.db(dbName).collection('users').findOne({ _id: oid });
      expect(doc!['tags']).toEqual(['admin']);
      expect(doc!['loginCount']).toBe(5);
    });

    it('updateAll with callback updates multiple documents', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      await orm.users.create(defaultUserData);
      await orm.users.create({ ...defaultUserData, name: 'Bob', email: 'bob@test.com' });

      const rows: unknown[] = [];
      for await (const row of orm.users
        .where({ loginCount: 0 })
        .updateAll((u: FieldAccessor<Contract, 'User'>) => [u.loginCount.inc(1)])) {
        rows.push(row);
      }
      expect(rows).toHaveLength(2);

      const docs = await client.db(dbName).collection('users').find({}).toArray();
      for (const doc of docs) {
        expect(doc['loginCount']).toBe(1);
      }
    });
  });

  describe('upsert() dot-path guard', () => {
    it('throws when callback uses a dot-path operation', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      await orm.users.create(defaultUserData);
      await expect(
        orm.users.where({ name: 'Alice' }).upsert({
          create: { ...defaultUserData, homeAddress: { city: 'SF', country: 'US' } },
          update: (u) => [u('homeAddress.city').set('LA')],
        }),
      ).rejects.toThrow('dot-path');
    });
  });

  describe('reference relation include', () => {
    it('include() on 1:N relation returns array of related documents', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);

      await orm.tasks.create({
        title: 'Task 1',
        type: 'bug',
        assigneeId: user._id as string,
      } as never);
      await orm.tasks.create({
        title: 'Task 2',
        type: 'feature',
        assigneeId: user._id as string,
      } as never);

      const result = await orm.users
        .include('tasks')
        .where({ _id: user._id as string })
        .first();
      expect(result).not.toBeNull();
      const tasks = (result as Record<string, unknown>)['tasks'] as Record<string, unknown>[];
      expect(tasks).toHaveLength(2);
      const titles = tasks.map((t) => t['title']).sort();
      expect(titles).toEqual(['Task 1', 'Task 2']);
    });

    it('include() on 1:N returns empty array when no related documents', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);

      const result = await orm.users
        .include('tasks')
        .where({ _id: user._id as string })
        .first();
      expect(result).not.toBeNull();
      const tasks = (result as Record<string, unknown>)['tasks'] as unknown[];
      expect(tasks).toEqual([]);
    });

    it('select() keeps a 1:N include whose join key is not selected', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      await orm.tasks.create({
        title: 'Task 1',
        type: 'bug',
        assigneeId: user._id as string,
      } as never);

      const result = await orm.users
        .select('name')
        .include('tasks')
        .where({ _id: user._id as string })
        .first();

      expect(result).toEqual({
        name: 'Alice',
        tasks: [
          { _id: expect.anything(), title: 'Task 1', type: 'bug', assigneeId: expect.anything() },
        ],
      });
    });

    it('select() keeps an N:1 include whose join key is not selected', async () => {
      const orm = mongoOrm({ contract, executor: runtime });
      const user = await orm.users.create(defaultUserData);
      await orm.tasks.create({
        title: 'Task 1',
        type: 'bug',
        assigneeId: user._id as string,
      } as never);

      const result = await orm.tasks.select('title').include('assignee').first();

      expect(result).toEqual({
        title: 'Task 1',
        assignee: {
          _id: expect.anything(),
          name: 'Alice',
          email: 'alice@test.com',
          loginCount: 0,
          tags: [],
          homeAddress: null,
        },
      });
    });
  });
});
