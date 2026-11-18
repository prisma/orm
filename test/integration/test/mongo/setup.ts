import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import mongoRuntimeDriver from '@internal/driver-mongo/runtime';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import type { MongoContract } from '@internal/mongo-contract';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoExecutionContext,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json';

export const fixtureContract = new MongoContractSerializer().deserializeContract(
  contractJson,
) as Contract;

export function executionContextFor<TContract extends MongoContract>(
  contract: TContract,
): MongoExecutionContext<TContract> {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  return createMongoExecutionContext({ contract, stack });
}

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
      driver: mongoRuntimeDriver,
    });
    const context = createMongoExecutionContext({ contract: fixtureContract, stack });
    const driver = stack.driver.create();
    await driver.connect({ kind: 'url', url: connectionUri, dbName });
    runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });

    const ctx: MongodContext = {
      connectionUri,
      dbName,
      client,
      runtime,
      context,
    };
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
  /** The execution context over the fixture contract, which `mongoOrm()` and `mongoRaw()` take. */
  readonly context: MongoExecutionContext<Contract>;
}

export function describeWithMongoDB(name: string, fn: (ctx: MongodContext) => void): void {
  describe(name, { timeout: timeouts.spinUpMongoMemoryServer }, () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let runtime: MongoRuntime;
    let context: MongoExecutionContext<Contract>;
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
      get context() {
        return context;
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
        driver: mongoRuntimeDriver,
      });
      context = createMongoExecutionContext({ contract: fixtureContract, stack });
      const driver = stack.driver.create();
      await driver.connect({ kind: 'url', url: replSet.getUri(), dbName });
      runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
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
