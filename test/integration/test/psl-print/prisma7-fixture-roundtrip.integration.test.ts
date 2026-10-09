import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { blindCast } from '@internal/utils/casts';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  composePostgresStack,
  printAndReadBack,
  printContract,
  serializedWithoutCapabilities,
  sourceContext,
} from './print-and-read-back';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/2-sql/2-authoring/contract-prisma7/test/fixtures',
);

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(fixturesDir, name, 'expected-contract.json')))
  .sort();

interface ExpectedRefusal {
  readonly reason: string;
  readonly error: unknown;
}

const modelInTwoNamespaces = (meta: Record<string, unknown>): ExpectedRefusal => ({
  reason: 'one model name in two namespaces',
  error: expect.objectContaining({
    code: 'CONTRACT.PRINT_UNSUPPORTED',
    message: expect.stringContaining('is declared in more than one namespace'),
    meta,
  }),
});

const storageWithNoModel: ExpectedRefusal = {
  reason: 'storage with no model has no Prisma 8 syntax yet',
  error: expect.objectContaining({
    code: 'CONTRACT.PRINT_UNSUPPORTED',
    message: expect.stringMatching(
      /is not stored by any field|that no relation of model .* travels|has no model stored in it/,
    ),
  }),
};

/** The fixtures `contract print` refuses, each with why and the refusal it throws. */
const expectedRefusals: ReadonlyMap<string, ExpectedRefusal> = new Map([
  ['ignore', storageWithNoModel],
  ['ignored-field-defaults', storageWithNoModel],
  ['ignored-field-in-index', storageWithNoModel],
  ['ignored-model-many-to-many', storageWithNoModel],
  ['ignored-models', storageWithNoModel],
  ['ignored-relation-back-relations', storageWithNoModel],
  ['ignored-relation-field', storageWithNoModel],
  [
    'junction-name-in-other-schema',
    modelInTwoNamespaces({ modelName: 'PostToTag', namespaces: ['one', 'two'] }),
  ],
  [
    'relation-name-in-two-schemas',
    modelInTwoNamespaces({ modelName: 'X', namespaces: ['one', 'two'] }),
  ],
  ['relations-ignored', storageWithNoModel],
]);

function prisma7SchemaPath(caseName: string): string {
  const directory = join(fixturesDir, caseName, 'schema');
  return existsSync(directory) ? directory : join(fixturesDir, caseName, 'schema.prisma');
}

async function loadPrisma7Fixture(
  schemaPath: string,
  caseName: string,
): Promise<Contract<SqlStorage>> {
  const result = await prisma7Contract(schemaPath, {
    binding: prisma7PostgresBinding,
  }).source.load(sourceContext(composePostgresStack(), [schemaPath]));
  if (!result.ok) {
    throw new Error(
      `Prisma 7 fixture "${caseName}" did not load: ${JSON.stringify(result.failure.diagnostics)}`,
    );
  }
  return blindCast<Contract<SqlStorage>, 'the Prisma 7 source yields a SQL contract'>(result.value);
}

async function roundTrip(caseName: string): Promise<void> {
  const schemaPath = prisma7SchemaPath(caseName);
  const prisma7 = await loadPrisma7Fixture(schemaPath, caseName);
  const printedContract = await printAndReadBack(prisma7);

  expect(serializedWithoutCapabilities(printedContract)).toEqual(
    serializedWithoutCapabilities(prisma7),
  );
  expect(printedContract.storage.storageHash).toBe(prisma7.storage.storageHash);
}

describe('a printed Prisma 7 contract reads back as the same contract', () => {
  for (const caseName of cases) {
    const refusal = expectedRefusals.get(caseName);
    if (refusal !== undefined) {
      it(`${caseName} is refused: ${refusal.reason}`, async () => {
        const prisma7 = await loadPrisma7Fixture(prisma7SchemaPath(caseName), caseName);
        expect(() => printContract(prisma7)).toThrow(refusal.error);
      });
      continue;
    }
    it(caseName, async () => {
      await roundTrip(caseName);
    });
  }
});
