/**
 * The end-to-end proof for the Prisma 7 contract source on Postgres: the SQL
 * Prisma 7.10.0 generated for the supported schema is applied unchanged, the
 * schema is interpreted, and strict `db verify` reports only what Prisma 7
 * creates for `@ignore` and `@@ignore` constructs, and the column default left
 * behind by the `@default(now())` removed beside `@updatedAt`. See
 * `fixtures/prisma7-source/supported-verify/README.md` for the three edits that
 * make the schema interpretable and the full schema's error case.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { dirname, join } from 'pathe';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  runSchemaVerify,
  timeouts,
  useDevDatabase,
  withClient,
} from '../family.schema-verify.helpers';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/prisma7-source');
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
    dataTypeLookup: stack.dataTypeLookup,
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

async function interpretVerifiableSchema(): Promise<unknown> {
  const loaded = await load(join(fixturesDir, 'supported-verify/schema.prisma'));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return new PostgresContractSerializer().serializeContract(loaded.value as Contract<SqlStorage>);
}

describe('Prisma 7 supported schema against the database Prisma 7 built', () => {
  const { getConnectionString } = useDevDatabase();

  beforeAll(async () => {
    await withClient(getConnectionString(), (client) => client.query(migrationSql));
  }, timeouts.spinUpPpgDev);

  it('verifies strictly with only the ignored constructs as extras', async () => {
    const serialized = await interpretVerifiableSchema();
    const lenient = await runSchemaVerify(getConnectionString(), serialized);
    expect(lenient.schema.issues).toEqual([]);
    expect(lenient.ok).toBe(true);

    const strict = await runSchemaVerify(getConnectionString(), serialized, { strict: true });
    expect(strict.schema.issues.map((issue) => issue.path).sort()).toEqual([
      ['database', 'public', 'LegacyThing'],
      ['database', 'public', 'LegacyThing', 'column:id'],
      ['database', 'public', 'LegacyThing', 'primary-key'],
      ['database', 'public', 'Post', 'column:legacyOwnerId'],
      ['database', 'public', 'Post', 'foreign-key:legacyOwnerId->public.User(id)'],
      ['database', 'public', 'Timestamps', 'column:updatedAtNow', 'default'],
      ['database', 'public', 'User', 'column:legacy'],
    ]);
  });

  it('reports a Decimal default that lost digits', async () => {
    const serialized = JSON.stringify(await interpretVerifiableSchema());
    expect(serialized.split('"12345678901234567890.123456789"')).toHaveLength(2);
    const rounded: unknown = JSON.parse(
      serialized.replace('"12345678901234567890.123456789"', '"12345678901234567000"'),
    );

    const result = await runSchemaVerify(getConnectionString(), rounded);
    expect(result.schema.issues.map((issue) => issue.path)).toEqual([
      ['database', 'public', 'NumberDefaults', 'column:longDecimal', 'default'],
    ]);
  });

  it('verifies timestamptz defaults when the session time zone is not UTC', async () => {
    const serialized = await interpretVerifiableSchema();
    await withClient(getConnectionString(), (client) => client.query("SET TIME ZONE 'Asia/Tokyo'"));
    try {
      // The dev database serves every connection from one session, so verify's
      // connection starts in this time zone too.
      const printed = await withClient(getConnectionString(), (client) =>
        client.query(
          `SELECT column_default FROM information_schema.columns
           WHERE table_name = 'TemporalDefaults' AND column_name = 'timestamptz'`,
        ),
      );
      expect(printed.rows).toEqual([
        { column_default: "'2024-01-02 10:04:05+09'::timestamp with time zone" },
      ]);

      const result = await runSchemaVerify(getConnectionString(), serialized);
      expect(result.schema.issues).toEqual([]);
    } finally {
      await withClient(getConnectionString(), (client) => client.query('RESET TIME ZONE'));
    }
  });

  it('rejects an optional generated field and @updatedAt with @default in the full supported schema', async () => {
    const loaded = await load(join(fixturesDir, 'supported/schema.prisma'));
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.failure.diagnostics.map((d) => [d.code, d.span?.start.line]).sort()).toEqual([
      ['PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', 115],
      ['PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED', 96],
      ['PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED', 97],
    ]);
  });
});
