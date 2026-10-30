/**
 * A Prisma 7 schema with `@db.Citext` columns, read with the citext pack composed, against the database the SQL Prisma 7.10.0 generated for it builds once `CREATE EXTENSION citext` has run: lenient and strict `db verify` report nothing.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import citext from '@internal/extension-citext/control';
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

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/prisma7-source/citext',
);
const schemaPath = join(fixtureDir, 'schema.prisma');
const expectedContractPath = join(fixtureDir, 'expected-contract.json');

function loadWithCitext(path: string) {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [citext],
  });
  return prisma7Contract(path, { binding: prisma7PostgresBinding }).source.load({
    composedExtensions: stack.extensions.map((extension) => extension.id),
    defaultNamespaceId: stack.target.defaultNamespaceId,
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypes: stack.dataTypes,
    controlMutationDefaults: stack.controlMutationDefaults,
    generatorFunctions: stack.generatorFunctions,
    resolvedInputs: [path],
    capabilities: stack.capabilities,
  });
}

async function interpretWithCitext(): Promise<unknown> {
  const loaded = await loadWithCitext(schemaPath);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return JSON.parse(
    JSON.stringify(
      new PostgresContractSerializer().serializeContract(loaded.value as Contract<SqlStorage>),
    ),
  );
}

describe('Prisma 7 @db.Citext columns against the database Prisma 7 built', () => {
  const { getConnectionString } = useDevDatabase();

  beforeAll(async () => {
    await withClient(getConnectionString(), async (client) => {
      await client.query('CREATE EXTENSION IF NOT EXISTS citext');
      await client.query(readFileSync(join(fixtureDir, 'migration.sql'), 'utf8'));
    });
  }, timeouts.spinUpPpgDev);

  it('reads as the contract recorded beside the schema', async () => {
    const serialized = await interpretWithCitext();
    if (process.env['UPDATE_PRISMA7_FIXTURES'] === '1') {
      writeFileSync(expectedContractPath, `${JSON.stringify(serialized, null, 2)}\n`);
    }
    expect(existsSync(expectedContractPath)).toBe(true);
    expect(serialized).toEqual(JSON.parse(readFileSync(expectedContractPath, 'utf8')));
  });

  it(
    'verifies with zero lenient and zero strict findings',
    async () => {
      const serialized = await interpretWithCitext();

      const lenient = await runSchemaVerify(getConnectionString(), serialized, {
        extensions: [citext],
      });
      expect(lenient.schema.issues).toEqual([]);

      const strict = await runSchemaVerify(getConnectionString(), serialized, {
        strict: true,
        extensions: [citext],
      });
      expect(strict.schema.issues).toEqual([]);
    },
    timeouts.spinUpPpgDev,
  );

  it('reports the datasource entry once when it puts citext in another schema than the pack does', async () => {
    const loaded = await loadWithCitext(join(fixtureDir, 'extension-in-another-schema.prisma'));
    expect(
      loaded.ok ? [] : loaded.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL.PRISMA7_EXTENSION_SCHEMA_MISMATCH',
        message:
          'Extension "citext": the "citext" extension pack declares it in schema "public", so Prisma 8 expects it there, but this entry puts it in schema "extensions". Moving it is a database change the pack does not make: move it with ALTER EXTENSION "citext" SET SCHEMA "public", then remove schema: "extensions".',
      },
    ]);
  });

  it('refuses a generator default, which no generator function binds to the citext codec', async () => {
    const loaded = await loadWithCitext(join(fixtureDir, 'generator-default.prisma'));
    expect(
      loaded.ok ? [] : loaded.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([
      {
        code: 'PSL.PRISMA7_UNKNOWN_DEFAULT',
        message:
          'Field "Token.value": @default function "uuid()" cannot fill a column of codec "pg/citext@1".',
      },
    ]);
  });
});
