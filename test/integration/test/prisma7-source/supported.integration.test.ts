/**
 * The end-to-end proof for the Prisma 7 contract source on Postgres: the SQL
 * Prisma 7.10.0 generated for the supported schema is applied unchanged, the
 * schema is interpreted, and `db verify` (lenient, the default) reports
 * nothing. See `fixtures/prisma7-source/supported-verify/README.md` for the three
 * edits that make the schema interpretable and the full schema's error case.
 */
import { readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import postgres from '@internal/target-postgres/control';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';

const fixturesDir = join(dirname(new URL(import.meta.url).pathname), '../fixtures/prisma7-source');
const migrationSql = readFileSync(join(fixturesDir, 'supported/migration.sql'), 'utf8');

function sourceContext(schemaPath: string) {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  };
}

function load(schemaPath: string) {
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load(
    sourceContext(schemaPath),
  );
}

describe('Prisma 7 supported schema against the database Prisma 7 built', () => {
  it(
    'verifies with zero findings',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, (client) => client.query(migrationSql));
        const loaded = await load(join(fixturesDir, 'supported-verify/schema.prisma'));
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const serialized = new PostgresContractSerializer().serializeContract(
          loaded.value as Contract<SqlStorage>,
        );
        const result = await runSchemaVerify(connectionString, serialized);
        expect(result.schema.issues.map((issue) => issue.path).sort()).toEqual([]);
        expect(result.ok).toBe(true);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it('rejects the full supported schema for the two forms Prisma 8 cannot spell', async () => {
    const loaded = await load(join(fixturesDir, 'supported/schema.prisma'));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.failure.diagnostics.map((d) => [d.code, d.span?.start.line]).sort()).toEqual([
      ['PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', 114],
      ['PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', 95],
      ['PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED', 96],
    ]);
  });
});
