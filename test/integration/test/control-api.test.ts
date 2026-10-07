import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { sqlEmission } from '@internal/sql-contract-emitter';
import postgres from '@internal/target-postgres/control';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../utils/emit';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a test contract for testing.
 */
function createTestContract(): Contract<SqlStorage> {
  return defineContract({
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  });
}

/**
 * Emits the contract to disk using the family instance.
 * Returns the contract JSON for use in tests.
 */
async function emitContract(
  contract: Contract<SqlStorage>,
  testDir: string,
): Promise<Record<string, unknown>> {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: undefined,
    extensions: [],
  });

  const emitResult = await emit(contract, stack, sqlEmission, {
    serializeContract: (c) =>
      postgres.contractSerializer.serializeContract(
        c as Parameters<typeof postgres.contractSerializer.serializeContract>[0],
      ),
    ...sqlContractCanonicalizationHooks,
  });

  // Write contract files
  const contractJsonPath = resolve(testDir, 'output/contract.json');
  const contractDtsPath = resolve(testDir, 'output/contract.d.ts');
  mkdirSync(dirname(contractJsonPath), { recursive: true });
  mkdirSync(dirname(contractDtsPath), { recursive: true });
  writeFileSync(contractJsonPath, emitResult.contractJson, 'utf-8');
  writeFileSync(contractDtsPath, emitResult.contractDts, 'utf-8');

  return JSON.parse(emitResult.contractJson) as Record<string, unknown>;
}

// ============================================================================
// Tests
// ============================================================================

describe('control-api', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe(
    'client lifecycle',
    () => {
      it(
        'connects and closes correctly',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            await client.connect(connectionString);
            await client.close();
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'allows reconnect after close',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            await client.connect(connectionString);
            await client.close();
            await client.connect(connectionString);
            await client.close();
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'verify operation',
    () => {
      it(
        'returns ok: false when marker does not exist',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.verify({
                contract: contractJson,
              });

              expect(result.ok).toBe(false);
              // Summary contains "Marker missing"
              expect(result.summary.toLowerCase()).toContain('marker missing');
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'introspect operation',
    () => {
      it(
        'returns schema IR',
        async () => {
          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.introspect();

              expect(result).toBeDefined();
              expect(typeof result).toBe('object');
              // `introspect()` returns the target's schema-IR node — for Postgres
              // the `PostgresDatabaseSchemaNode` tree root: namespaces keyed by
              // DDL schema, each carrying a `tables` record (always at least the
              // live `public` schema).
              expect(result).toMatchObject({
                namespaces: {
                  public: { schemaName: 'public', tables: expect.anything() },
                },
              });
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'dbInit operation',
    () => {
      it(
        'plans operations without applying',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contract: contractJson,
                mode: 'plan',
                migrationsDir: resolve(testDir, 'migrations'),
              });

              expect(result.ok).toBe(true);
              if (result.ok) {
                expect(result.value.mode).toBe('plan');
                expect(result.value.plan.operations.length).toBeGreaterThan(0);
                expect(result.value.summary).toContain('Planned');
              }
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'applies operations and writes marker',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);
              const result = await client.dbInit({
                contract: contractJson,
                mode: 'apply',
                migrationsDir: resolve(testDir, 'migrations'),
              });

              expect(result).toMatchObject({
                ok: true,
                value: {
                  mode: 'apply',
                  execution: expect.anything(),
                  marker: expect.objectContaining({ storageHash: expect.any(String) }),
                  summary: expect.stringContaining('Applied'),
                },
              });

              // Verify marker was written by calling verify
              const verifyResult = await client.verify({
                contract: contractJson,
              });
              expect(verifyResult.ok).toBe(true);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'returns success when already at target state',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);

              const migrationsDir = resolve(testDir, 'migrations');

              // Apply first time
              const result1 = await client.dbInit({
                contract: contractJson,
                mode: 'apply',
                migrationsDir,
              });
              expect(result1.ok).toBe(true);

              // Apply second time - should be idempotent. The per-space
              // flow achieves idempotency by the planner returning an
              // empty plan and the runner being a no-op on empty plans.
              const result2 = await client.dbInit({
                contract: contractJson,
                mode: 'apply',
                migrationsDir,
              });

              expect(result2.ok).toBe(true);
              if (result2.ok) {
                expect(result2.value.plan.operations).toHaveLength(0);
                expect(result2.value.execution?.operationsExecuted).toBe(0);
              }
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'sign operation',
    () => {
      it(
        'signs database after schema setup',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);

              // First init the database
              const initResult = await client.dbInit({
                contract: contractJson,
                mode: 'apply',
                migrationsDir: resolve(testDir, 'migrations'),
              });
              expect(initResult.ok).toBe(true);

              const familyInstance = sql.create(
                createControlStack({
                  family: sql,
                  target: postgres,
                  adapter: postgresAdapter,
                  driver: postgresDriver,
                  extensions: [],
                }),
              );
              const signResult = await client.dbSign({
                contract: familyInstance.deserializeContract(contractJson),
                migrationsDir: resolve(testDir, 'migrations'),
              });

              expect(signResult.assertOk().spaces).toMatchObject([
                { space: 'app', status: 'unchanged' },
              ]);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );

  describe(
    'schemaVerify operation',
    () => {
      it(
        'verifies schema after db init',
        async () => {
          const contract = createTestContract();
          const contractJson = await emitContract(contract, testDir);

          await withDevDatabase(async ({ connectionString }) => {
            const client = createControlClient({
              family: sql,
              target: postgres,
              adapter: postgresAdapter,
              driver: postgresDriver,
              extensions: [],
            });

            try {
              await client.connect(connectionString);

              // First init the database
              const initResult = await client.dbInit({
                contract: contractJson,
                mode: 'apply',
                migrationsDir: resolve(testDir, 'migrations'),
              });
              expect(initResult.ok).toBe(true);

              // Then verify schema
              const schemaResult = await client.schemaVerify({
                contract: contractJson,
                strict: false,
              });

              expect(schemaResult.ok).toBe(true);
              expect(schemaResult.schema.issues).toEqual([]);
            } finally {
              await client.close();
            }
          });
        },
        timeouts.spinUpPpgDev,
      );
    },
    timeouts.spinUpPpgDev,
  );
});
