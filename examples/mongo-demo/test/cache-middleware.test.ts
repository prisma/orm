import type { CacheAnnotationOptions } from '@prisma/orm-extension-middleware-cache';
import { cacheAnnotation, createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import mongoRuntimeAdapter from '@prisma/orm-mongo/adapter/runtime';
import { createMongoDriver } from '@prisma/orm-mongo/driver';
import { MongoContractSerializer } from '@prisma/orm-mongo/family/ir';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
} from '@prisma/orm-mongo/family-runtime';
import { mongoOrm } from '@prisma/orm-mongo/orm';
import type { MongoQueryPlan } from '@prisma/orm-mongo/query-ast/execution';
import { mongoQuery } from '@prisma/orm-mongo/query-builder';
import mongoRuntimeTarget from '@prisma/orm-mongo/target/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };
import { seed } from '../src/seed';

const contract = new MongoContractSerializer().deserializeContract<Contract>(contractJson);

/**
 * End-to-end check that a real Mongo runtime + the cross-family
 * `@internal/middleware-cache` + an annotated read short-circuits on
 * the second call. The same plan is executed twice; the second call
 * never reaches the driver because the cache middleware serves it from
 * the in-process store. Runs against `mongodb-memory-server` rather than
 * a mock context so the cross-family path is exercised by real code.
 */
describe('mongo-demo cache middleware integration', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const dbName = 'cache_demo_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  function withCacheAnnotation<P extends MongoQueryPlan>(
    plan: P,
    options: CacheAnnotationOptions,
  ): P {
    return {
      ...plan,
      meta: {
        ...plan.meta,
        annotations: {
          ...plan.meta.annotations,
          cache: cacheAnnotation(options),
        },
      },
    };
  }

  async function buildRuntime() {
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract, stack });
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    const driverExecuteSpy = vi.spyOn(driver, 'execute');
    const cache = createCacheMiddleware();
    const runtime = createMongoRuntime({ context, driver, middleware: [cache] });
    const orm = mongoOrm({ contract, executor: runtime });
    const query = mongoQuery<Contract>({ contractJson });
    return { runtime, orm, query, driver, driverExecuteSpy };
  }

  it('serves a repeated annotated read from cache without hitting the driver', async () => {
    const { runtime, orm, query, driverExecuteSpy } = await buildRuntime();

    try {
      await seed(orm);

      // Spy was created before seeding; clear seed-time invocations so we
      // count only the read calls below.
      driverExecuteSpy.mockClear();

      const plan = withCacheAnnotation(
        query.from('posts').sort({ createdAt: -1 }).limit(5).build(),
        {},
      );

      const first = await runtime.query(plan).toArray();
      const callsAfterFirst = driverExecuteSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      expect(first.length).toBeGreaterThan(0);

      // Same plan, identical annotation → cache hit, driver not invoked.
      const second = await runtime.query(plan).toArray();
      expect(driverExecuteSpy.mock.calls.length).toBe(callsAfterFirst);
      expect(second).toEqual(first);
    } finally {
      await runtime.close();
    }
  });

  it('still hits the driver for an un-annotated plan (cache is opt-in)', async () => {
    const { runtime, orm, query, driverExecuteSpy } = await buildRuntime();

    try {
      await seed(orm);
      driverExecuteSpy.mockClear();

      const plan = query.from('posts').sort({ createdAt: -1 }).limit(5).build();

      await runtime.query(plan).toArray();
      const callsAfterFirst = driverExecuteSpy.mock.calls.length;

      // Un-annotated plan: the cache middleware passes through.
      await runtime.query(plan).toArray();
      expect(driverExecuteSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      await runtime.close();
    }
  });

  it('does not cache a plan whose cacheAnnotation has bypass: true', async () => {
    const { runtime, orm, query, driverExecuteSpy } = await buildRuntime();

    try {
      await seed(orm);
      driverExecuteSpy.mockClear();

      const plan = withCacheAnnotation(
        query.from('posts').sort({ createdAt: -1 }).limit(5).build(),
        { bypass: true },
      );

      await runtime.query(plan).toArray();
      const callsAfterFirst = driverExecuteSpy.mock.calls.length;

      // Same plan, but bypass: true skips the cache. Driver hit again.
      await runtime.query(plan).toArray();
      expect(driverExecuteSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      await runtime.close();
    }
  });
});
