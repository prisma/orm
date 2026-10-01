import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoControlDriver from '../src/exports/control';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
});

afterAll(async () => {
  await replSet?.stop();
});

describe('mongoControlDriver descriptor', () => {
  it('has correct descriptor meta', () => {
    expect(mongoControlDriver.kind).toBe('driver');
    expect(mongoControlDriver.familyId).toBe('mongo');
    expect(mongoControlDriver.targetId).toBe('mongo');
    expect(mongoControlDriver.id).toBe('mongo');
  });

  it('creates a connected control driver from a URL', async () => {
    const url = replSet.getUri('control_driver_test');
    const driver = await mongoControlDriver.create(url);

    try {
      expect(driver.familyId).toBe('mongo');
      expect(driver.targetId).toBe('mongo');
      expect(driver.db).toBeDefined();
      expect(driver.db.databaseName).toBe('control_driver_test');
    } finally {
      await driver.close();
    }
  });

  it('reports the database the connection string names', async () => {
    const driver = await mongoControlDriver.create(replSet.getUri('shop'));

    try {
      expect(await driver.databaseName()).toBe('shop');
    } finally {
      await driver.close();
    }
  });

  it('exposes db that can execute commands', async () => {
    const url = replSet.getUri('control_driver_commands');
    const driver = await mongoControlDriver.create(url);

    try {
      await driver.db.collection('test_col').insertOne({ hello: 'world' });
      const doc = await driver.db.collection('test_col').findOne({ hello: 'world' });
      expect(doc).toMatchObject({ hello: 'world' });
    } finally {
      await driver.close();
    }
  });

  it('close() disconnects the client', async () => {
    const url = replSet.getUri('control_driver_close');
    const driver = await mongoControlDriver.create(url);
    await driver.close();

    await expect(driver.db.collection('test').insertOne({ x: 1 })).rejects.toThrow();
  });

  it('throws on invalid connection URL', async () => {
    await expect(
      mongoControlDriver.create('mongodb://invalid-host-that-does-not-exist:99999/testdb'),
    ).rejects.toThrow();
  });
});
