/**
 * Decimal and BigInt number defaults keep every digit Prisma 7 wrote: the SQL
 * Prisma 7.10.0 generated for `fixtures/prisma7-source/number-defaults` is
 * applied unchanged, and strict `db verify` reports nothing.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { prisma7Schema } from '@internal/postgres/config';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prisma7-source/number-defaults',
);
const schemaPath = join(fixtureDir, 'schema.prisma');
const migrationSql = readFileSync(join(fixtureDir, 'migration.sql'), 'utf8');

function load() {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return prisma7Schema(schemaPath).source.load({
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
}

describe('Prisma 7 Decimal and BigInt number defaults against the database Prisma 7 built', () => {
  it(
    'verify strictly with zero findings',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, (client) => client.query(migrationSql));
        const loaded = await load();
        if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
        const serialized = new PostgresContractSerializer().serializeContract(
          loaded.value as Contract<SqlStorage>,
        );
        const result = await runSchemaVerify(connectionString, serialized, { strict: true });
        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);

        const rounded = JSON.parse(
          JSON.stringify(serialized).replace(
            '"12345678901234567890.123456789"',
            '"12345678901234567000"',
          ),
        );
        const roundedResult = await runSchemaVerify(connectionString, rounded, { strict: true });
        expect(roundedResult.schema.issues.map((issue) => issue.path)).toEqual([
          ['database', 'public', 'Decimals', 'column:long', 'default'],
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
