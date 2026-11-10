import { readFileSync } from 'node:fs';
import {
  extractDb,
  introspectSchema,
  MongoControlAdapterImpl,
} from '@prisma/orm-mongo/adapter/control';
import mongoControlDriver from '@prisma/orm-mongo/driver/control';
import { verifyMongoSchema } from '@prisma/orm-mongo/family/schema-verify';
import type { MongoContract } from '@prisma/orm-mongo/family-contract';
import { MongoMigrationRunner } from '@prisma/orm-mongo/target/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { resolve } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};

const MIG1_DIR = '20260513T0505_initial';
const MIG2_DIR = '20260513T0507_add_product_category_index';
const MIG3_DIR = '20260513T0508_backfill_product_status';

const UNBOUND_NAMESPACE_ID = '__unbound__' as const;

type FlatMongoStorage = {
  storageHash: string;
  collections: Record<string, unknown>;
};

function namespacedMongoContract(contract: MongoContract): MongoContract {
  const storage = contract.storage;
  if ('namespaces' in storage && storage.namespaces != null) {
    return contract;
  }
  if (!('collections' in storage)) {
    return contract;
  }
  const { collections, storageHash, ...rest } = storage as FlatMongoStorage;
  // Test-only rewrap of a legacy on-disk contract snapshot whose storageHash
  // is a plain string. MongoContract's storage carries a branded StorageHash;
  // the brand is purely a type-level marker and the runtime payload is
  // identical, so a structural rewrap is safe here.
  return {
    ...contract,
    storage: {
      ...rest,
      storageHash,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'mongo-namespace' as const,
          entries: { collection: collections },
        },
      },
    },
  } as unknown as MongoContract;
}

function loadMigration(dirName: string): {
  ops: ReturnType<typeof JSON.parse>;
  endContract: MongoContract;
} {
  const dir = resolve(import.meta.dirname, '../migrations/app', dirName);
  const ops = JSON.parse(readFileSync(resolve(dir, 'ops.json'), 'utf8'));
  const metadata = JSON.parse(readFileSync(resolve(dir, 'migration.json'), 'utf8')) as {
    to: string;
  };
  const snapshotHex = metadata.to;
  const snapshotPath = resolve(
    import.meta.dirname,
    '../migrations/snapshots',
    snapshotHex,
    'contract.json',
  );
  const endContract = namespacedMongoContract(
    JSON.parse(readFileSync(snapshotPath, 'utf8')) as MongoContract,
  );
  return { ops, endContract };
}

describe('full retail-store migration chain (m1 → m2 → m3)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'migration_chain_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore cleanup errors
    }
  }, timeouts.spinUpMongoMemoryServer);

  it('applies all three migrations, post-apply schema satisfies the contract, and pre-existing products are backfilled', async () => {
    const m1 = loadMigration(MIG1_DIR);
    const m2 = loadMigration(MIG2_DIR);
    const m3 = loadMigration(MIG3_DIR);

    const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const runner = new MongoMigrationRunner(
        new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
      );

      // Migration 1 — bootstrap. No origin (greenfield); strict verify on.
      const r1 = await runner.execute({
        plan: {
          targetId: 'mongo',
          destination: { storageHash: m1.endContract.storage.storageHash },
          operations: m1.ops,
        },
        destinationContract: m1.endContract,
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: true,
        migrationEdges: [
          {
            migrationHash: m1.endContract.storage.storageHash,
            dirName: MIG1_DIR,
            from: '',
            to: m1.endContract.storage.storageHash,
            operationCount: m1.ops.length,
          },
        ],
      });
      expect(r1.ok, `m1 failed: ${JSON.stringify(r1)}`).toBe(true);

      // Migration 2 — add a non-validator index.
      const r2 = await runner.execute({
        plan: {
          targetId: 'mongo',
          origin: { storageHash: m1.endContract.storage.storageHash },
          destination: { storageHash: m2.endContract.storage.storageHash },
          operations: m2.ops,
        },
        destinationContract: m2.endContract,
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: true,
        migrationEdges: [
          {
            migrationHash: m2.endContract.storage.storageHash,
            dirName: MIG2_DIR,
            from: m1.endContract.storage.storageHash,
            to: m2.endContract.storage.storageHash,
            operationCount: m2.ops.length,
          },
        ],
      });
      expect(r2.ok, `m2 failed: ${JSON.stringify(r2)}`).toBe(true);

      // Seed two pre-existing products that pre-date the `status` field.
      // These conform to the state-2 strict validator (which doesn't yet
      // include `status`); migration 3 adds `status` to the validator and
      // backfills the value.
      await db.collection('products').insertMany([
        {
          name: 'Pre-existing widget A',
          brand: 'Acme',
          code: 'A001',
          description: 'A widget that pre-dates the status field',
          primaryCategory: 'Apparel',
          subCategory: 'Topwear',
          articleType: 'T-Shirts',
          price: { amount: 10.99, currency: 'USD' },
          image: { url: 'http://example.com/a.png' },
        },
        {
          name: 'Pre-existing widget B',
          brand: 'Acme',
          code: 'B001',
          description: 'Another pre-existing widget',
          primaryCategory: 'Apparel',
          subCategory: 'Bottomwear',
          articleType: 'Trousers',
          price: { amount: 20.99, currency: 'USD' },
          image: { url: 'http://example.com/b.png' },
        },
      ]);

      // Migration 3 — refresh validator + dataTransform backfill.
      const r3 = await runner.execute({
        plan: {
          targetId: 'mongo',
          origin: { storageHash: m2.endContract.storage.storageHash },
          destination: { storageHash: m3.endContract.storage.storageHash },
          operations: m3.ops,
        },
        destinationContract: m3.endContract,
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: true,
        migrationEdges: [
          {
            migrationHash: m3.endContract.storage.storageHash,
            dirName: MIG3_DIR,
            from: m2.endContract.storage.storageHash,
            to: m3.endContract.storage.storageHash,
            operationCount: m3.ops.length,
          },
        ],
      });
      expect(r3.ok, `m3 failed: ${JSON.stringify(r3)}`).toBe(true);

      // Independent verify call: introspect the live DB and diff against
      // the state-3 contract. Belt-and-braces — the runner already verified
      // post-apply (gating its marker advance on it), but this re-run
      // makes the assertion explicit at the test layer and would catch
      // any future drift between runner-internal verify and stand-alone
      // `verifyMongoSchema`.
      const liveSchema = await introspectSchema(extractDb(controlDriver));
      const verifyResult = verifyMongoSchema({
        contract: m3.endContract,
        schema: liveSchema,
        strict: true,
        frameworkComponents: [],
      });
      expect(verifyResult.ok, `post-chain verify failed: ${JSON.stringify(verifyResult)}`).toBe(
        true,
      );

      // Marker should have advanced to the state-3 hash via migration 3.
      const marker = await db
        .collection<{ _id: string; storageHash: string }>('_prisma_migrations')
        .findOne({ _id: 'app' });
      expect(marker?.storageHash).toBe(m3.endContract.storage.storageHash);

      // Backfill: pre-existing products now carry `status: 'active'`.
      const products = await db.collection('products').find({}).toArray();
      expect(products).toHaveLength(2);
      for (const p of products) {
        expect(p['status']).toBe('active');
      }
    } finally {
      await controlDriver.close();
    }
  });
});
