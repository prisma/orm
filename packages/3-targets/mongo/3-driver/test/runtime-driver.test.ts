import {
  AggregateWireCommand,
  DropCollectionWireCommand,
  InsertOneWireCommand,
} from '@internal/mongo-wire';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoRuntimeDriver from '../src/exports/runtime';

let replSet: MongoMemoryReplSet;
let connectionUri: string;
const dbName = 'runtime_driver_test';
const unreachableUrl = 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  connectionUri = replSet.getUri();
});

afterAll(async () => {
  await replSet?.stop();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function spyOnClients() {
  return {
    connect: vi.spyOn(MongoClient.prototype, 'connect'),
    close: vi.spyOn(MongoClient.prototype, 'close'),
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

const countAll = (collection: string) =>
  new AggregateWireCommand(collection, [{ $count: 'total' }]);

describe('the Mongo runtime driver descriptor', () => {
  it('describes the mongo driver', () => {
    expect(mongoRuntimeDriver).toMatchObject({
      kind: 'driver',
      familyId: 'mongo',
      targetId: 'mongo',
      id: 'mongo',
    });
  });

  it('creates a driver that is not connected', async () => {
    const driver = mongoRuntimeDriver.create();

    expect(driver).toMatchObject({ familyId: 'mongo', targetId: 'mongo' });
    await expect(collect(driver.execute(countAll('things')))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo driver not connected. Call connect(binding) before execute or run.',
    });
    await expect(driver.run(new DropCollectionWireCommand('things'))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });
  });
});

describe('a Mongo runtime driver connected to a URL', () => {
  it('runs commands against the database the binding names', async () => {
    const driver = mongoRuntimeDriver.create();
    await driver.connect({ kind: 'url', url: connectionUri, dbName });
    try {
      await collect(driver.execute(new InsertOneWireCommand('by_url', { name: 'Ada' })));
      const verify = new MongoClient(connectionUri);
      try {
        expect(await verify.db(dbName).collection('by_url').countDocuments()).toBe(1);
      } finally {
        await verify.close();
      }
    } finally {
      await driver.close();
    }
  });

  it('closes the client it created on close()', async () => {
    const clients = spyOnClients();
    const driver = mongoRuntimeDriver.create();
    await driver.connect({ kind: 'url', url: connectionUri, dbName });
    expect(clients.close).not.toHaveBeenCalled();

    await driver.close();

    expect(clients.close).toHaveBeenCalledTimes(1);
    await expect(collect(driver.execute(countAll('by_url')))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo driver is closed. Call connect(binding) to reconnect.',
    });
  });

  it('refuses a second connect() with DRIVER.ALREADY_CONNECTED', async () => {
    const driver = mongoRuntimeDriver.create();
    await driver.connect({ kind: 'url', url: connectionUri, dbName });
    try {
      await expect(
        driver.connect({ kind: 'url', url: connectionUri, dbName }),
      ).rejects.toMatchObject({
        code: 'DRIVER.ALREADY_CONNECTED',
        message:
          'Mongo driver already connected. Call close() before reconnecting with a new binding.',
      });
    } finally {
      await driver.close();
    }
  });

  it('stays unconnected after a failed connect, so a later connect can succeed', async () => {
    const clients = spyOnClients();
    const driver = mongoRuntimeDriver.create();

    await expect(driver.connect({ kind: 'url', url: unreachableUrl, dbName })).rejects.toThrow();
    expect(clients.close).toHaveBeenCalledTimes(1);
    await expect(collect(driver.execute(countAll('by_url')))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });

    await driver.connect({ kind: 'url', url: connectionUri, dbName });
    try {
      expect(await collect(driver.execute(countAll('never_written')))).toEqual([]);
    } finally {
      await driver.close();
    }
  });
});

describe('a Mongo runtime driver that is connecting', () => {
  it('refuses a second connect() while the first is pending, and opens one client', async () => {
    const clients = spyOnClients();
    const driver = mongoRuntimeDriver.create();
    const first = driver.connect({ kind: 'url', url: connectionUri, dbName });

    await expect(driver.connect({ kind: 'url', url: connectionUri, dbName })).rejects.toMatchObject(
      { code: 'DRIVER.ALREADY_CONNECTED' },
    );
    await first;
    try {
      expect(clients.connect).toHaveBeenCalledTimes(1);
    } finally {
      await driver.close();
    }
  });

  it('leaves nothing open when close() runs during the connect', async () => {
    const clients = spyOnClients();
    const driver = mongoRuntimeDriver.create();
    const connecting = driver.connect({ kind: 'url', url: connectionUri, dbName });

    await driver.close();

    await expect(connecting).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo driver is closed. Call connect(binding) to reconnect.',
    });
    expect(clients.close).toHaveBeenCalledTimes(1);
    await expect(collect(driver.execute(countAll('by_url')))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo driver is closed. Call connect(binding) to reconnect.',
    });
  });

  it('closes cleanly when close() runs during a connect that fails', async () => {
    const driver = mongoRuntimeDriver.create();
    const connecting = driver.connect({ kind: 'url', url: unreachableUrl, dbName });

    await driver.close();

    await expect(connecting).rejects.toThrow();
    await expect(collect(driver.execute(countAll('by_url')))).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Mongo driver is closed. Call connect(binding) to reconnect.',
    });
  });
});

describe('a Mongo runtime driver connected to a caller`s MongoClient', () => {
  it('runs commands and leaves the client open on close()', async () => {
    const client = new MongoClient(connectionUri);
    await client.connect();
    try {
      const clients = spyOnClients();
      const driver = mongoRuntimeDriver.create();
      await driver.connect({ kind: 'mongoClient', client, dbName });
      await collect(driver.execute(new InsertOneWireCommand('by_client', { name: 'Grace' })));
      await driver.close();

      expect(clients.close).not.toHaveBeenCalled();
      expect(await client.db(dbName).collection('by_client').countDocuments()).toBe(1);
    } finally {
      await client.close();
    }
  });
});
