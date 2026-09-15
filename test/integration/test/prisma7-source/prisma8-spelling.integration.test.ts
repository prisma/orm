/**
 * Proves, before any printer exists, that every construct the Prisma 7 source
 * produces has a Prisma 8 PSL spelling: `contract.prisma` beside the
 * `supported-verify` schema was written by hand from the slice 3 printing
 * rules, interprets through the PSL source to the same contract (three
 * hashes and the domain plane), and `db verify` reports nothing against the
 * SQL Prisma 7.10.0 generated for that schema.
 */
import { readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Schema } from '@internal/sql-contract-prisma7/provider';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres, {
  INSTANT_NOW_GENERATOR_ID,
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
} from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresTypeMap } from '@internal/target-postgres/prisma7-type-map';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';
import { expectSameContract } from './round-trip.helpers';

const fixturesDir = join(dirname(new URL(import.meta.url).pathname), '../fixtures/prisma7-source');
const prisma7SchemaPath = join(fixturesDir, 'supported-verify/schema.prisma');
const prisma8ContractPath = join(fixturesDir, 'supported-verify/contract.prisma');
const migrationSql = readFileSync(join(fixturesDir, 'supported/migration.sql'), 'utf8');

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

function sourceContext(inputPath: string): ContractSourceContext {
  return {
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [inputPath],
    capabilities: stack.capabilities,
  };
}

async function loadPrisma7(): Promise<Contract> {
  const loaded = await prisma7Schema(prisma7SchemaPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
    typeMap: prisma7PostgresTypeMap,
    updatedAt: {
      generatorIdFor: ({ codecId }) =>
        codecId === 'pg/timestamptz-temporal@1'
          ? INSTANT_NOW_GENERATOR_ID
          : PLAIN_DATE_TIME_NOW_GENERATOR_ID,
    },
  }).source.load(sourceContext(prisma7SchemaPath));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
  return loaded.value;
}

async function loadPrisma8(): Promise<Contract> {
  const loaded = await prismaContract(prisma8ContractPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(sourceContext(prisma8ContractPath));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
  return loaded.value;
}

describe('hand-written Prisma 8 spelling of the supported Prisma 7 schema', () => {
  it('interprets to the same contract as the Prisma 7 source', async () => {
    expectSameContract(await loadPrisma8(), await loadPrisma7());
  });

  it(
    'verifies with zero findings against the database Prisma 7 built',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        await withClient(connectionString, (client) => client.query(migrationSql));
        const prisma8 = await loadPrisma8();
        expectSameContract(prisma8, await loadPrisma7());
        const serialized = new PostgresContractSerializer().serializeContract(
          prisma8 as Contract<SqlStorage>,
        );
        const result = await runSchemaVerify(connectionString, serialized);
        expect(result.schema.issues.map((issue) => issue.path).sort()).toEqual([]);
        expect(result.ok).toBe(true);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
