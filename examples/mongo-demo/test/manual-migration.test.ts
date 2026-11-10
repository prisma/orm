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
import AddUserRoleEnum from '../migrations/app/20260626T1605_add_user_role_enum/migration';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

const migrationDir = resolve(
  import.meta.dirname,
  '../migrations/app/20260626T1605_add_user_role_enum',
);

describe('planner-generated migration (20260626T1605_add_user_role_enum)', {
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
    const instance = new AddUserRoleEnum();
    const ops = instance.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('validator.users.update');
  });

  it('migration.json has expected structure', () => {
    const manifest = JSON.parse(readFileSync(resolve(migrationDir, 'migration.json'), 'utf-8'));

    expect(manifest.migrationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.from).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.to).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ops.json deserializes and applies against real MongoDB', async () => {
    await db.createCollection('users');

    const opsJson = readFileSync(resolve(migrationDir, 'ops.json'), 'utf-8');
    const ops = deserializeMongoOps(JSON.parse(opsJson));
    expect(ops).toHaveLength(1);

    const controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
    try {
      const runner = new MongoMigrationRunner(
        new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
      );
      const result = await runner.execute({
        plan: {
          targetId: 'mongo',
          destination: {
            storageHash: '250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
          },
          operations: JSON.parse(opsJson),
        },
        // Synthetic-contract opt-out (paired with `strictVerification: false`):
        // this test feeds ops.json to the runner without a full contract.
        destinationContract: {
          storage: {
            storageHash: '250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
            namespaces: {
              __unbound__: {
                id: '__unbound__',
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
            migrationHash: '250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
            dirName: 'planner-generated-migration',
            from: '',
            to: '250af57beb0580c2c9562789d5d05ae39bcfabd08b2eca8367f59a70fa724b7d',
            operationCount: ops.length,
          },
        ],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.operationsExecuted).toBe(1);

      // The collMod should have set the validator with the enum constraint.
      // Verify via listCollections — the options.validator.$jsonSchema should
      // include the role enum.
      const collections = await db.listCollections({ name: 'users' }).toArray();
      expect(collections).toHaveLength(1);
      const collectionInfo = collections[0]! as Record<string, unknown>;
      const validator = (collectionInfo['options'] as Record<string, unknown> | undefined)?.[
        'validator'
      ];
      expect(validator).toBeDefined();
      const jsonSchema = (validator as Record<string, unknown> | undefined)?.['$jsonSchema'];
      expect(jsonSchema).toBeDefined();
      const roleField = (
        (jsonSchema as Record<string, unknown> | undefined)?.['properties'] as
          | Record<string, unknown>
          | undefined
      )?.['role'];
      expect(roleField).toMatchObject({ bsonType: 'string', enum: ['admin', 'author', 'reader'] });
    } finally {
      await controlDriver.close();
    }
  });
});
