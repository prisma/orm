import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import type { PlanMeta } from '@internal/contract/types';
import { createMongoDriver } from '@internal/driver-mongo';
import type { MongoCodecRegistry } from '@internal/mongo-codec';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export interface MongodContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
  // Tests need to install synthetic codecs (e.g. throwing decoders) after
  // the runtime is built. The public `MongoExecutionContext.codecs` exposes
  // only the read-only `MongoCodecLookup` view; here we surface the
  // underlying mutable `MongoCodecRegistry` that
  // `createMongoExecutionContext` constructed, so test fixtures can install
  // codecs against the same registry the runtime decodes against.
  // Production callers must not reach for this — see
  // `createMongoExecutionContext` and `MongoCodecLookup`.
  readonly codecs: MongoCodecRegistry;
  readonly stubMeta: PlanMeta;
}

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
};

export async function withMongod<T>(fn: (ctx: MongodContext) => Promise<T>): Promise<T> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
    ],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const connectionUri = replSet.getUri();
  const dbName = 'test';
  const client = new MongoClient(connectionUri);
  await client.connect();

  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  const context = createMongoExecutionContext({ contract: {}, stack });
  const driver = await createMongoDriver(connectionUri, dbName);
  const runtime = createMongoRuntime({ context, driver });

  // Cast back to `MongoCodecRegistry` — the test setup is the one place that
  // legitimately mutates the per-execution registry mid-flight (to install
  // synthetic codecs for failure-mode tests). The aggregation in
  // `createMongoExecutionContext` returns a real `MongoCodecRegistry`
  // structurally; we just narrowed the public type to hide `register()` from
  // user-facing code.
  const codecs = context.codecs as MongoCodecRegistry;

  const ctx: MongodContext = {
    connectionUri,
    dbName,
    client,
    runtime,
    codecs,
    stubMeta,
  };

  try {
    return await fn(ctx);
  } finally {
    await runtime.close();
    await client.close();
    await replSet.stop();
  }
}
