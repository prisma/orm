import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { blindCast } from '@internal/utils/casts';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  printAndReadBack,
  printContract,
  serializedWithoutCapabilities,
} from '../../../../3-targets/6-adapters/postgres/test/helpers/psl-print';
import { prisma7Contract } from '../src/provider';
import { postgresSourceContext } from './support';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(fixturesDir, name, 'expected-contract.json')))
  .sort();

/** The fixtures `contract print` refuses, each with the meta of its refusal. */
const expectedRefusals: ReadonlyMap<string, Record<string, unknown>> = new Map([
  ['junction-name-in-other-schema', { modelName: 'PostToTag', namespaces: ['one', 'two'] }],
  ['relation-name-in-two-schemas', { modelName: 'X', namespaces: ['one', 'two'] }],
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
  }).source.load(postgresSourceContext([schemaPath]));
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
      it(`${caseName} is refused: one model name in two namespaces`, async () => {
        const prisma7 = await loadPrisma7Fixture(prisma7SchemaPath(caseName), caseName);
        expect(() => printContract(prisma7)).toThrow(
          expect.objectContaining({
            code: 'CONTRACT.PRINT_UNSUPPORTED',
            message: expect.stringContaining('is declared in more than one namespace'),
            meta: refusal,
          }),
        );
      });
      continue;
    }
    it(caseName, async () => {
      await roundTrip(caseName);
    });
  }
});
