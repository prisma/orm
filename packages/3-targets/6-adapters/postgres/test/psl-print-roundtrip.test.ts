import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import postgresAdapter from '../src/exports/control';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/**
 * Contracts emitted from TypeScript sources, one per feature a Prisma 7 schema
 * cannot carry. Each is printed as PSL, read back through the PSL source, and
 * must come back as the same contract.
 */
const cases: ReadonlyArray<{ readonly name: string; readonly contractJson: string }> = [
  {
    name: 'value objects',
    contractJson: 'test/integration/test/value-objects/fixtures/generated/sql-contract.json',
  },
  {
    name: 'polymorphism: discriminator, base, variants, owner',
    contractJson:
      'test/integration/test/sql-orm-client/fixtures/polymorphism/generated/contract.json',
  },
  {
    name: 'named types and typeRef columns',
    contractJson:
      'test/integration/test/ports/prisma/functional/decimal-list/_fixture/generated/contract.json',
  },
];

function sourceContext(resolvedInputs: readonly string[]): ContractSourceContext {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs,
    capabilities: stack.capabilities,
  };
}

function loadContract(relativePath: string): Contract<SqlStorage> {
  const json: unknown = JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf-8'));
  return new PostgresContractSerializer().deserializeContract(json);
}

function printAsPsl(contract: Contract<SqlStorage>): string {
  const ast = postgres.printPslContract?.(contract);
  if (ast === undefined) throw new Error('the Postgres target has no printPslContract hook');
  const context = sourceContext([]);
  return printPsl(ast, {
    pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
    codecLookup: context.codecLookup,
  });
}

async function readBack(text: string): Promise<Contract<SqlStorage>> {
  const printedPath = join(mkdtempSync(join(tmpdir(), 'psl-print-')), 'contract.prisma');
  writeFileSync(printedPath, text);
  const result = await prismaContract(printedPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(sourceContext([printedPath]));
  if (!result.ok) {
    throw new Error(
      `the printed PSL did not load: ${JSON.stringify(result.failure.diagnostics)}\n${text}`,
    );
  }
  return blindCast<Contract<SqlStorage>, 'the Postgres PSL source yields a SQL contract'>(
    result.value,
  );
}

/** The serialized contract without `capabilities`, which the composed stack reports rather than the source. */
function serialize(contract: Contract<SqlStorage>): unknown {
  const { capabilities: _, ...authored } = JSON.parse(
    JSON.stringify(new PostgresContractSerializer().serializeContract(contract)),
  );
  return authored;
}

/**
 * Contracts authored in PSL, one per feature the emitted TypeScript fixtures
 * above do not carry. Each is read, printed, read back, and compared.
 */
const pslCases: ReadonlyArray<{ readonly name: string; readonly schema: string }> = [
  {
    name: 'a model control policy',
    schema: `model Ledger {
  id Int @id

  @@control(external)
}
`,
  },
  {
    name: 'an index with a predicate, a type, options and an expression',
    schema: `model Doc {
  id   Int    @id
  body String
  tags String[]

  @@index([body], type: "gin", options: { fastupdate: "off" }, name: "doc_body_gin")
  @@index([id], where: "id > 10", name: "doc_recent")
  @@index(expression: "lower(body)", name: "doc_body_lower")
  @@index([tags], unique: true, name: "doc_tags_key")
}
`,
  },
  {
    name: 'a domain enum with membership checks on a scalar and a list column',
    schema: `enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

model Task {
  id         Int        @id
  priority   Priority
  priorities Priority[]
  waived     Priority   @noCheck(membership)
  preset     Priority   @default(Low)
}
`,
  },
];

describe('a printed PSL contract reads back as the same contract', () => {
  it.each(pslCases)('$name', async ({ schema }) => {
    const authored = await readBack(`// use prisma-8\n${schema}`);
    const printed = await readBack(printAsPsl(authored));

    expect(serialize(printed)).toEqual(serialize(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});

describe('a contract the language cannot carry is refused by name', () => {
  it('refuses the entities an extension contributes, naming their kind', () => {
    const authored = loadContract('packages/3-extensions/supabase/src/contract/contract.json');
    expect(() => printAsPsl(authored)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message: expect.stringMatching(/declares \d+ "(role|rls)" entit/),
      }),
    );
  });

  it('refuses a to-one relation that travels no foreign key', () => {
    const authored = loadContract(
      'test/integration/test/sql-orm-client/fixtures/generated/contract.json',
    );
    expect(() => printAsPsl(authored)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message: expect.stringContaining('"Article.reviewer"'),
      }),
    );
  });
});

describe('a printed TypeScript contract reads back as the same contract', () => {
  it.each(cases)('$name', async ({ contractJson }) => {
    const authored = loadContract(contractJson);
    const printed = await readBack(printAsPsl(authored));

    expect(serialize(printed)).toEqual(serialize(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});
