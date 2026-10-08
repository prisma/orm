import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { createMongoDriver } from '@internal/driver-mongo';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoCodecLookup,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

export async function withMongod<T>(fn: (ctx: MongodContext) => Promise<T>): Promise<T> {
  let replSet: MongoMemoryReplSet | undefined;
  let client: MongoClient | undefined;
  let runtime: MongoRuntime | undefined;

  try {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const connectionUri = replSet.getUri();
    const dbName = 'test';
    client = new MongoClient(connectionUri);
    await client.connect();

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    const driver = await createMongoDriver(connectionUri, dbName);
    runtime = createMongoRuntime({ context, driver });

    const ctx: MongodContext = { connectionUri, dbName, client, runtime, codecs: context.codecs };
    return await fn(ctx);
  } finally {
    await runtime?.close();
    await client?.close();
    await replSet?.stop();
  }
}

export interface MongodContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
  /** The execution context's codecs, which `buildMongoEnums()` reads enum members through. */
  readonly codecs: MongoCodecLookup;
}

export function describeWithMongoDB(name: string, fn: (ctx: MongodContext) => void): void {
  describe(name, { timeout: timeouts.spinUpMongoMemoryServer }, () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let runtime: MongoRuntime;
    let codecs: MongoCodecLookup;
    const dbName = 'test';

    const ctx: MongodContext = {
      get connectionUri() {
        return replSet.getUri();
      },
      dbName,
      get client() {
        return client;
      },
      get runtime() {
        return runtime;
      },
      get codecs() {
        return codecs;
      },
    };

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        instanceOpts: [
          { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
        ],
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
      codecs = context.codecs;
    }, timeouts.spinUpMongoMemoryServer);

    beforeEach(async () => {
      await client.db(dbName).dropDatabase();
    });

    afterAll(async () => {
      try {
        await runtime?.close();
        await client?.close();
        await replSet?.stop();
      } catch {
        // Ignore cleanup errors
      }
    }, timeouts.spinUpMongoMemoryServer);

    fn(ctx);
  });
}
