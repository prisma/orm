import { readFileSync } from 'node:fs';
import { MongoControlAdapterImpl } from '@prisma/orm-mongo/adapter/control';
import mongoControlDriver from '@prisma/orm-mongo/driver/control';
import type { MongoContract } from '@prisma/orm-mongo/family-contract';
import { deserializeMongoOps, MongoMigrationRunner } from '@prisma/orm-mongo/target/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { resolve } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import BackfillProductStatus from '../migrations/app/20260513T0508_backfill_product_status/migration';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};

const migrationDir = resolve(
  import.meta.dirname,
  '../migrations/app/20260513T0508_backfill_product_status',
);

describe('hand-authored migration (backfill-product-status)', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'manual_migration_test';

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

  it('migration class can be imported and operations accessed directly', () => {
    const instance = new BackfillProductStatus();
    const ops = instance.operations;
    expect(ops).toHaveLength(2);
    expect(ops[0]!.id).toBe('collection.products.setValidation');
    expect(ops[1]!.id).toBe('data_transform.backfill-product-status');
  });

  it('migration.json has expected structure', () => {
    const manifest = JSON.parse(readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8'));

    expect(manifest.migrationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.from).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.to).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ops.json deserializes and applies against real MongoDB, backfilling missing status', async () => {
    // Pre-create `products` so `setValidation` (op 1) has a collection to
    // collMod. In a full chain run, migration 1's `createCollection`
    // would do this; the isolated test stands it up directly.
    await db.createCollection('products');

    // Seed two pre-existing products that pre-date the `status` field;
    // the data transform should observe both and update them.
    // Records must satisfy the state-3 validator that migration 3's
    // setValidation op installs (since the runner applies setValidation
    // before the dataTransform, and updateMany re-validates each touched
    // document). Decimal price.amount values match the contract's
    // `bsonType: "double"` requirement.
    await db.collection('products').insertMany([
      {
        name: 'Pre-existing widget A',
        brand: 'Acme',
        code: 'A001',
        description: 'a widget',
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
        description: 'another widget',
        primaryCategory: 'Apparel',
        subCategory: 'Bottomwear',
        articleType: 'Trousers',
        price: { amount: 20.99, currency: 'USD' },
        image: { url: 'http://example.com/b.png' },
      },
    ]);

    const opsJson = readFileSync(resolve(migrationDir, 'ops.json'), 'utf-8');
    const ops = deserializeMongoOps(JSON.parse(opsJson));
    expect(ops).toHaveLength(2);

    const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const runner = new MongoMigrationRunner(
        new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
      );
      // Synthetic-contract opt-out (paired with `strictVerification: false`):
      // this test isolates migration 3's apply mechanics against a real
      // driver, without first running migrations 1 + 2. We supply the
      // minimum well-formed shape the verifier reads (`storage.namespaces`)
      // so it degrades to an empty-expected diff rather than failing on
      // peer collections (carts, orders, …) that the chain prerequisites
      // would normally create.
      const STORAGE_HASH = '50134e16bc78b848f51f2dc00025eb3b4bbcbee55f402f7d9b71608a1b2d0c65';
      const UNBOUND_NAMESPACE_ID = '__unbound__' as const;
      const result = await runner.execute({
        plan: {
          targetId: 'mongo',
          destination: { storageHash: STORAGE_HASH },
          operations: JSON.parse(opsJson),
        },
        destinationContract: {
          storage: {
            storageHash: STORAGE_HASH,
            namespaces: {
              [UNBOUND_NAMESPACE_ID]: {
                id: UNBOUND_NAMESPACE_ID,
                kind: 'mongo-namespace' as const,
                entries: { collection: {} },
              },
            },
          },
        } as unknown as MongoContract,
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: false,
        migrationEdges: [
          {
            migrationHash: STORAGE_HASH,
            dirName: 'manual-migration',
            from: '',
            to: STORAGE_HASH,
            operationCount: ops.length,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.operationsExecuted).toBe(2);

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
