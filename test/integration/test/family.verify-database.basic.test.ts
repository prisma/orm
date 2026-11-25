import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
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

describe('family instance verify - basic', () => {
  it(
    'verifies database with matching marker via driver',
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

            // Write marker matching contract
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
          expect(result.timings.total).toBeGreaterThanOrEqual(0);
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
    'rejects contract without profileHash',
    async () => {
      const testDirWithDb = createIntegrationTestDir();

      try {
        const testContract2 = createTestContract();
        await emitContract(testContract2, testDirWithDb);

        const contractJsonPath = resolve(testDirWithDb, 'output/contract.json');
        const contractJsonContent = await readFile(contractJsonPath, 'utf-8');
        const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
        if (Object.hasOwn(contractJson, 'profileHash')) {
          const { profileHash: _profileHash, ...contractWithoutProfileHash } = contractJson;
          await writeFile(
            contractJsonPath,
            JSON.stringify(contractWithoutProfileHash, null, 2),
            'utf-8',
          );
        }

        expect(() => loadContract(testDirWithDb)).toThrow('profileHash');
      } finally {
        if (existsSync(testDirWithDb)) {
          rmSync(testDirWithDb, { recursive: true, force: true });
        }
      }
    },
    timeouts.spinUpPpgDev,
  );
});
