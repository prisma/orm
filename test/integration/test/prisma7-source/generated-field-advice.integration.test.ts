/**
 * Each diagnostic for a generated value Prisma 8 cannot express points at the
 * attribute its message says to remove. Removing exactly those attributes from
 * the supported schema must give a contract that verifies with zero findings
 * against the SQL Prisma 7.10.0 generated for the unedited schema.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/prisma7-source');
const supportedSchema = readFileSync(join(fixturesDir, 'supported/schema.prisma'), 'utf8');
const migrationSql = readFileSync(join(fixturesDir, 'supported/migration.sql'), 'utf8');

function load(directory: string, fileName: string, schema: string) {
  const schemaPath = join(directory, fileName);
  writeFileSync(schemaPath, schema);
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

describe('advice for generated values Prisma 8 cannot express', () => {
  it(
    'removing the attribute each diagnostic names makes the supported schema verify against the database Prisma 7 built',
    async () => {
      const directory = mkdtempSync(join(tmpdir(), 'prisma7-advice-'));
      try {
        await removeAdvisedAttributesAndVerify(directory);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    timeouts.spinUpPpgDev,
  );
});

async function removeAdvisedAttributesAndVerify(directory: string): Promise<void> {
  const rejected = await load(directory, 'supported.prisma', supportedSchema);
  expect(rejected.ok).toBe(false);
  if (rejected.ok) return;
  const advice = rejected.failure.diagnostics
    .map((diagnostic) => {
      const span = diagnostic.span;
      if (span === undefined) throw new Error(`${diagnostic.code} has no span`);
      return {
        code: diagnostic.code,
        message: diagnostic.message,
        start: span.start.offset,
        end: span.end.offset,
        attribute: supportedSchema.slice(span.start.offset, span.end.offset),
      };
    })
    .sort((left, right) => left.start - right.start);
  expect(advice.map(({ code, attribute }) => [code, attribute])).toEqual([
    ['PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', '@updatedAt'],
    ['PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED', '@default(now())'],
    ['PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', '@default(uuid())'],
  ]);
  for (const { message, attribute } of advice) {
    expect(message).toContain(`Remove ${attribute}`);
  }

  const edited = advice.reduceRight(
    (schema, { start, end }) => schema.slice(0, start) + schema.slice(end),
    supportedSchema,
  );
  const loaded = await load(directory, 'edited.prisma', edited);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  await withDevDatabase(async ({ connectionString }) => {
    await withClient(connectionString, (client) => client.query(migrationSql));
    const result = await runSchemaVerify(
      connectionString,
      new PostgresContractSerializer().serializeContract(loaded.value as Contract<SqlStorage>),
    );
    expect(result.schema.issues.map((issue) => issue.path)).toEqual([]);
    expect(result.ok).toBe(true);
  });
}
