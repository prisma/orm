import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Contract } from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import contractJson from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract.json' with {
  type: 'json',
};
import { defineContract, field, model } from '../src/exports/contract-builder';
import mongo from '../src/runtime/mongo';
import { contractFromJson } from '../src/static/contract-from-json';

const contract = contractFromJson<Contract>(contractJson);

const accountsContract = defineContract({
  models: {
    Account: model('Account', {
      collection: 'accounts',
      fields: { _id: field.objectId(), email: field.string() },
    }),
  },
});

// End-to-end smoke test for the lazy mongo() facade. Exercises the full
// orm → executor → runtime → driver chain against a real (in-memory) replica
// set.
//
// `MongoMemoryReplSet` (not `MongoMemoryServer`) is deliberate: FR4.4
// documents that transactions and change streams require a replica set, so
// the e2e environment matches the production story we point users at. A
// future test that exercises `withTransaction()` (when TML-2313 lands) will
// already work against this fixture without changes.
//
// We use `{ uri, dbName }` rather than `{ url }` because `MongoMemoryReplSet`
// returns URIs with a `?replicaSet=...` query string, which makes path-based
// dbName injection ambiguous.
describe('mongo() facade — e2e (replica set)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  it('orm and query are available before any connection is made', () => {
    const db = mongo({
      contract,
      uri: replSet.getUri(),
      dbName: 'facade_eager',
    });
    expect(db.orm).toBeDefined();
    expect(db.orm.users).toBeDefined();
    expect(db.orm.tasks).toBeDefined();
    expect(db.query).toBeDefined();
  });

  it(
    'createAll + where().first() round-trips through the lazy facade',
    async () => {
      const db = mongo({
        contract,
        uri: replSet.getUri(),
        dbName: 'facade_first',
      });

      try {
        const created = await db.orm.users.createAll([
          {
            name: 'Alice',
            email: 'alice@example.com',
            loginCount: 1,
            tags: ['admin'],
            homeAddress: null,
          },
          {
            name: 'Bob',
            email: 'bob@example.com',
            loginCount: 0,
            tags: [],
            homeAddress: null,
          },
        ]);

        expect(created).toHaveLength(2);
        expect(created[0]?._id).toBeTruthy();

        const alice = await db.orm.users.where({ email: 'alice@example.com' }).first();
        expect(alice?.name).toBe('Alice');
        expect(alice?.email).toBe('alice@example.com');
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );

  const runtimeClosed = { code: 'DRIVER.NOT_CONNECTED', message: 'Runtime is closed' };

  it(
    'a runtime the caller holds stops working after close(), for a URL binding',
    async () => {
      const db = mongo({
        contract: accountsContract,
        uri: replSet.getUri(),
        dbName: 'facade_held_url',
      });
      const runtime = await db.runtime();
      await db.close();

      await expect(
        runtime.query(db.query.from('accounts').build()).toArray(),
      ).rejects.toMatchObject(runtimeClosed);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'a runtime the caller holds stops working after close(), for a mongoClient binding, and the client stays open',
    async () => {
      const client = new MongoClient(replSet.getUri());
      await client.connect();
      try {
        const db = mongo({
          contract: accountsContract,
          mongoClient: client,
          dbName: 'facade_held_client',
        });
        const runtime = await db.runtime();
        await db.close();

        await expect(
          runtime.query(db.query.from('accounts').build()).toArray(),
        ).rejects.toMatchObject(runtimeClosed);
        expect(await client.db('facade_held_client').collection('accounts').countDocuments()).toBe(
          0,
        );
      } finally {
        await client.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'connect() is callable explicitly and drives the same lazy runtime',
    async () => {
      const db = mongo({ contract });
      try {
        await db.connect({ uri: replSet.getUri(), dbName: 'facade_explicit' });
        const users = await db.orm.users.all();
        expect([...users]).toHaveLength(0);
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'connect() after a query resolves with the runtime the query used',
    async () => {
      const db = mongo({
        contract,
        uri: replSet.getUri(),
        dbName: 'facade_after_query',
      });
      try {
        await db.orm.users.all();
        await expect(db.connect()).resolves.toBe(await db.runtime());
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'connect() with options rejects when the client is connected',
    async () => {
      const db = mongo({
        contract,
        uri: replSet.getUri(),
        dbName: 'facade_twice',
      });
      try {
        await db.connect();
        await expect(db.connect({ uri: replSet.getUri(), dbName: 'facade_twice' })).rejects.toThrow(
          'Mongo client is already bound',
        );
      } finally {
        await db.close();
      }
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
