/**
 * The converter's core property: for every Prisma 7 fixture the contract the
 * Prisma 7 source produces, printed as Prisma 8 PSL by the Postgres target's
 * `printPslContract` hook and interpreted by the PSL source, is the same
 * contract (three hashes and the domain plane). The printed text for the
 * supported schema is kept as a file snapshot beside dispatch 1's hand-written
 * spelling so the two can be compared.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
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
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { expectSameContract } from './round-trip.helpers';

const testDir = dirname(new URL(import.meta.url).pathname);
const integrationFixturesDir = join(testDir, '../fixtures/prisma7-source');
const corpusDir = join(
  testDir,
  '../../../../packages/2-sql/2-authoring/contract-prisma7/test/fixtures',
);

const CONVERT_HEADER = '// Converted from prisma/schema.prisma by `prisma contract convert`.';
const scratchDir = join(testDir, '../../../../wip/printer-round-trip');
const CORPUS_CASE_COUNT = 20;

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

async function loadPrisma7(inputPath: string): Promise<Contract> {
  const loaded = await prisma7Schema(inputPath, {
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
  }).source.load(sourceContext(inputPath));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
  return loaded.value;
}

async function loadPrisma8Text(text: string, caseName: string): Promise<Contract> {
  const dir = join(scratchDir, caseName);
  mkdirSync(dir, { recursive: true });
  const contractPath = join(dir, 'contract.prisma');
  writeFileSync(contractPath, text);
  const loaded = await prismaContract(contractPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(sourceContext(contractPath));
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
  return loaded.value;
}

function printContract(contract: Contract): string {
  if (postgres.printPslContract === undefined) {
    throw new Error('the Postgres target descriptor has no printPslContract hook');
  }
  return printPsl(postgres.printPslContract(contract as Contract<SqlStorage>), {
    header: CONVERT_HEADER,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
    codecLookup: stack.codecLookup,
  });
}

const corpusCases = readdirSync(corpusDir)
  .filter((name) => existsSync(join(corpusDir, name, 'expected-contract.json')))
  .sort()
  .map((name) => {
    const schemaFile = join(corpusDir, name, 'schema.prisma');
    const input = statSync(schemaFile, { throwIfNoEntry: false })?.isFile()
      ? schemaFile
      : join(corpusDir, name, 'schema');
    return { name, input };
  });

const integrationCases = ['supported-verify', 'relations'].map((name) => ({
  name,
  input: join(integrationFixturesDir, name, 'schema.prisma'),
}));

describe('Prisma 7 contract printed as Prisma 8 PSL interprets to the same contract', () => {
  afterAll(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it('covers the whole Prisma 7 fixture corpus', () => {
    expect(corpusCases.map((testCase) => testCase.name)).toHaveLength(CORPUS_CASE_COUNT);
  });

  it.each([...corpusCases, ...integrationCases])('$name', async ({ name, input }) => {
    const prisma7 = await loadPrisma7(input);
    const printed = printContract(prisma7);
    expectSameContract(await loadPrisma8Text(printed, name), prisma7);
  });

  it('the printed supported schema matches its snapshot beside the hand-written spelling', async () => {
    const printed = printContract(
      await loadPrisma7(join(integrationFixturesDir, 'supported-verify/schema.prisma')),
    );
    expect(printed.startsWith(`// use prisma-8\n${CONVERT_HEADER}\n`)).toBe(true);
    await expect(printed).toMatchFileSnapshot(
      join(integrationFixturesDir, 'supported-verify/printed.contract.prisma'),
    );
  });
});
