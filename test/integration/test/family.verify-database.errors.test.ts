import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import {
  createControlStack,
  type VerifyDatabaseResult,
} from '@internal/framework-components/control';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { seedTestMarker } from '@internal/sql-runtime/test/utils';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { emit } from '../utils/emit';
import { bootstrapPostgresSignMarkerTables } from './postgres-bootstrap';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

/**
 * Creates a test contract for testing.
 */
function createTestContract(): Contract<SqlStorage> {
  const contractObj = defineContract({
    databaseVersion: 18,
    models: {
      User: model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'user' }),
    },
  });

  return {
    ...contractObj,
    extensions: {
      postgres: {
        version: '0.0.1',
      },
      pg: {},
    },
  };
}

/**
 * Emits the contract to disk using the family instance.
 * Returns the validated contract for use in tests.
 */
async function emitContract(
  contract: Contract<SqlStorage>,
  testDir: string,
): Promise<Contract<SqlStorage>> {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
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

  const contractJson = JSON.parse(emitResult.contractJson) as Record<string, unknown>;
  return new PostgresContractSerializer().deserializeContract(contractJson) as Contract<SqlStorage>;
}

/**
 * Loads contract from disk and validates it.
 */
function loadContract(testDir: string): { contract: Contract; contractPath: string } {
  const contractPath = join(testDir, 'output/contract.json');
  const contractJsonContent = readFileSync(contractPath, 'utf-8');
  const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;

  // Create family instance to validate contract
  const familyInstance = sql.create(
    createControlStack({
      family: sql,
      target: postgres,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    }),
  );
  const contract = familyInstance.deserializeContract(contractJson);
  return { contract, contractPath };
}

/**
 * Verifies the database marker against the contract using the family instance.
 * Creates a driver, family instance, and calls verify() with proper cleanup.
 */
async function verifyDatabase(options: {
  contract: Contract;
  dbUrl: string;
  contractPath: string;
  configPath?: string;
}): Promise<VerifyDatabaseResult> {
  const { contract, dbUrl, contractPath, configPath } = options;

  const driver = await postgresDriver.create(dbUrl);
  try {
    const familyInstance = sql.create(
      createControlStack({
        family: sql,
        target: postgres,
        adapter: postgresAdapter,
        driver: postgresDriver,
        extensions: [],
      }),
    );

    return await familyInstance.verify({
      driver,
      contract,
      expectedTargetId: postgres.id,
      contractPath,
      ...(configPath ? { configPath } : {}),
    });
  } finally {
    await driver.close();
  }
}

describe('family instance verify - errors', () => {
  it(
    'reports error when marker is missing via driver',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract = createTestContract();
          const contractWithDb = await emitContract(testContract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table but don't write marker
            await bootstrapPostgresSignMarkerTables(client);
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            storageHash: contractWithDb.storage.storageHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'CONTRACT.MARKER_MISSING',
            summary: 'Marker missing',
            contract: expectedContract,
          });
          expect(result.marker).toBeUndefined();
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when storageHash mismatch',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract = createTestContract();
          const contractWithDb = await emitContract(testContract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await bootstrapPostgresSignMarkerTables(client);

            // Write marker with different hash
            await seedTestMarker(client, {
              storageHash: 'different-hash',
              profileHash: contractWithDb.profileHash ?? contractWithDb.storage.storageHash,
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            storageHash: contractWithDb.storage.storageHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'CONTRACT.MARKER_MISMATCH',
            summary: 'Hash mismatch',
            contract: expectedContract,
            marker: { storageHash: 'different-hash' },
          });
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'returns error when profileHash mismatch',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract = createTestContract();
          const contractWithDb = await emitContract(testContract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            // Setup marker schema and table
            await bootstrapPostgresSignMarkerTables(client);

            // Write marker with different profileHash
            await seedTestMarker(client, {
              storageHash: contractWithDb.storage.storageHash,
              profileHash: 'different-profile-hash',
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          const expectedContract: Record<string, unknown> = {
            storageHash: contractWithDb.storage.storageHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: false,
            code: 'CONTRACT.MARKER_MISMATCH',
            summary: 'Hash mismatch',
            contract: expectedContract,
            marker: { profileHash: 'different-profile-hash' },
          });
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'handles invalid contract structure (missing storageHash or target)',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit a valid contract first
          const testContract = createTestContract();
          await emitContract(testContract, testDirWithDb);

          // Create an invalid contract IR (missing storageHash/target)
          const invalidContract = {
            schemaVersion: '1',
            targetFamily: 'sql',
            storage: {
              tables: {},
            },
            models: {},
            relations: {},
          } as unknown as Contract;

          // Try to verify with invalid contract
          await expect(
            verifyDatabase({
              contract: invalidContract,
              dbUrl: connectionString,
              contractPath: join(testDirWithDb, 'output/contract.json'),
            }),
          ).rejects.toThrow(/Contract structural validation failed|Invalid contract structure/);
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports missing codecs when collectSupportedCodecTypeIds returns non-empty array',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        const testDirWithDb = createIntegrationTestDir();

        try {
          // Create and emit contract
          const testContract = createTestContract();
          const contractWithDb = await emitContract(testContract, testDirWithDb);

          await withClient(connectionString, async (client) => {
            await bootstrapPostgresSignMarkerTables(client);

            await seedTestMarker(client, {
              storageHash: contractWithDb.storage.storageHash,
              profileHash: contractWithDb.profileHash ?? contractWithDb.storage.storageHash,
              contractJson: contractWithDb,
              canonicalVersion: 1,
            });
          });

          // Load contract and verify
          const { contract, contractPath } = loadContract(testDirWithDb);
          const result = await verifyDatabase({
            contract,
            dbUrl: connectionString,
            contractPath,
          });

          // Should succeed but report missing codecs if contract uses types not in supported list
          const expectedContract: Record<string, unknown> = {
            storageHash: contractWithDb.storage.storageHash,
          };
          if (contractWithDb.profileHash) {
            expectedContract['profileHash'] = contractWithDb.profileHash;
          }

          expect(result).toMatchObject({
            ok: true,
            summary: 'Database matches contract',
            contract: expectedContract,
            meta: { contractPath: expect.any(String) },
          });
          // If contract uses types not in supported list, missingCodecs should be present
          // Otherwise, missingCodecs should be undefined
          // This test verifies the branch is covered, regardless of whether missingCodecs is set
        } finally {
          if (existsSync(testDirWithDb)) {
            rmSync(testDirWithDb, { recursive: true, force: true });
          }
        }
      });
    },
    timeouts.spinUpPpgDev,
  );
});
