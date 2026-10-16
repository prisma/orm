import { MongoFieldFilter } from '@prisma/orm-mongo/query-ast/execution';
import mongo from '@prisma/orm-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contract } from '../src/db';

describe('CRUD lifecycle', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const dbName = 'crud_lifecycle_test';
  const mongoDb = mongo({ contract });
  const orm = mongoDb.orm;

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

  it('create → read → update → read → delete → read', async () => {
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
      role: 'reader',
      address: null,
    });

    expect(alice._id).toBeDefined();
    expect(alice.name).toBe('Alice');
    expect(alice.email).toBe('alice@example.com');

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });

    const updated = await orm.users
      .where(MongoFieldFilter.eq('name', 'Alice'))
      .update({ name: 'Alice Updated', bio: 'Editor' });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Alice Updated');

    const afterUpdate = await orm.users.all();
    expect(afterUpdate).toHaveLength(1);
    expect(afterUpdate[0]).toMatchObject({ name: 'Alice Updated', bio: 'Editor' });

    const deleted = await orm.users.where(MongoFieldFilter.eq('name', 'Alice Updated')).delete();

    expect(deleted).not.toBeNull();
    expect(deleted!.name).toBe('Alice Updated');

    const afterDelete = await orm.users.all();
    expect(afterDelete).toHaveLength(0);
  });

  it('createAll → read → updateAll → read → deleteAll → read', async () => {
    const created = await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null, role: 'reader', address: null },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'reader', address: null },
      { name: 'Carol', email: 'carol@example.com', bio: null, role: 'reader', address: null },
    ]);

    expect(created).toHaveLength(3);
    const names = created.map((u) => u.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol']);

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(3);

    const updatedRows = await orm.users
      .where(MongoFieldFilter.in('name', ['Alice', 'Bob']))
      .updateAll({ bio: 'Updated bio' });

    expect(updatedRows).toHaveLength(2);
    for (const row of updatedRows) {
      expect(row.bio).toBe('Updated bio');
    }

    const carol = await orm.users.where(MongoFieldFilter.eq('name', 'Carol')).first();
    expect(carol).not.toBeNull();
    expect(carol!.bio).toBeNull();

    const deletedRows = await orm.users
      .where(MongoFieldFilter.in('name', ['Alice', 'Bob']))
      .deleteAll();

    expect(deletedRows).toHaveLength(2);

    const remaining = await orm.users.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: 'Carol' });
  });

  it('createAndCount returns inserted count', async () => {
    const count = await orm.users.createAndCount([
      { name: 'Alice', email: 'alice@example.com', bio: null, role: 'reader', address: null },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'reader', address: null },
    ]);

    expect(count).toBe(2);

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(2);
  });

  it('updateAndCount returns modified count', async () => {
    await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null, role: 'reader', address: null },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'reader', address: null },
      { name: 'Carol', email: 'carol@example.com', bio: 'existing', role: 'reader', address: null },
    ]);

    const count = await orm.users
      .where(MongoFieldFilter.eq('bio', null))
      .updateAndCount({ bio: 'filled' });

    expect(count).toBe(2);
  });

  it('deleteAndCount returns deleted count', async () => {
    await orm.users.createAll([
      { name: 'Alice', email: 'alice@example.com', bio: null, role: 'reader', address: null },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'reader', address: null },
      { name: 'Carol', email: 'carol@example.com', bio: 'keep', role: 'reader', address: null },
    ]);

    const count = await orm.users.where(MongoFieldFilter.eq('bio', null)).deleteAndCount();

    expect(count).toBe(2);

    const remaining = await orm.users.all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ name: 'Carol' });
  });

  it('upsert inserts when no match', async () => {
    const result = await orm.users.where(MongoFieldFilter.eq('email', 'new@example.com')).upsert({
      create: {
        name: 'New User',
        email: 'new@example.com',
        bio: 'New bio',
        role: 'reader',
        address: null,
      },
      update: { name: 'Updated Name' },
    });

    expect(result).toBeDefined();
    expect(result._id).toBeDefined();

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    // $set always applies on insert, so `name` comes from update, rest from $setOnInsert
    expect(allUsers[0]).toMatchObject({
      name: 'Updated Name',
      email: 'new@example.com',
      bio: 'New bio',
    });
  });

  it('create and read user with embedded Address value object', async () => {
    const address = { street: '789 Elm Blvd', city: 'Austin', zip: '73301', country: 'US' };

    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
      role: 'reader',
      address,
    });

    expect(alice.address).toEqual(address);

    const fetched = await orm.users
      .where(MongoFieldFilter.eq('email', 'alice@example.com'))
      .first();
    expect(fetched).not.toBeNull();
    expect(fetched!.address).toEqual(address);
  });

  it('create user with null address', async () => {
    const bob = await orm.users.create({
      name: 'Bob',
      email: 'bob@example.com',
      bio: null,
      role: 'reader',
      address: null,
    });

    expect(bob.address).toBeNull();

    const fetched = await orm.users.where(MongoFieldFilter.eq('email', 'bob@example.com')).first();
    expect(fetched).not.toBeNull();
    expect(fetched!.address).toBeNull();
  });

  it('update embedded Address value object', async () => {
    const original = { street: '100 First Ave', city: 'Seattle', zip: '98101', country: 'US' };

    await orm.users.create({
      name: 'Carol',
      email: 'carol@example.com',
      bio: null,
      role: 'reader',
      address: original,
    });

    const newAddress = { street: '200 Second St', city: 'Denver', zip: '80201', country: 'US' };
    const updated = await orm.users
      .where(MongoFieldFilter.eq('email', 'carol@example.com'))
      .update({ address: newAddress });

    expect(updated).not.toBeNull();
    expect(updated!.address).toEqual(newAddress);
  });

  it('upsert updates when match exists', async () => {
    await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
      role: 'reader',
      address: null,
    });

    const result = await orm.users.where(MongoFieldFilter.eq('email', 'alice@example.com')).upsert({
      create: {
        name: 'Should Not Insert',
        email: 'alice@example.com',
        bio: null,
        role: 'reader',
        address: null,
      },
      update: { name: 'Alice Upserted' },
    });

    expect(result).toBeDefined();

    const allUsers = await orm.users.all();
    expect(allUsers).toHaveLength(1);
    expect(allUsers[0]).toMatchObject({ name: 'Alice Upserted', email: 'alice@example.com' });
  });
});
