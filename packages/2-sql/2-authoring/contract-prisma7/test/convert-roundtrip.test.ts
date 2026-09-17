import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { blindCast } from '@internal/utils/casts';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import { loadPrintedPsl, postgresSourceContext, printContractAsPsl } from './support';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const cases = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(fixturesDir, name, 'expected-contract.json')))
  .sort();

const NULLABLE_LIST =
  'the printer cannot print a nullable list type, so a list column would come back not nullable';
const LOST_LIST_TYPE_PARAMS =
  'the PSL source drops type.typeParams from the domain field of a scalar list column';

/** Why each fixture does not round-trip yet, naming every cause it has. */
const expectedFailures: ReadonlyMap<string, readonly string[]> = new Map([
  [
    'defaults',
    [
      'a Json object literal default is refused, because PSL reads a quoted default back as a string',
    ],
  ],
  [
    'junction-name-in-other-schema',
    ['one model name in two namespaces cannot be written in a Prisma 8 schema'],
  ],
  [
    'relation-name-in-two-schemas',
    ['one model name in two namespaces cannot be written in a Prisma 8 schema'],
  ],
]);

/**
 * Fixtures the printer refuses rather than write a file that would read back as
 * a different contract, with the column it stops on and every reason it has.
 */
const refusedListColumns: ReadonlyMap<
  string,
  { readonly column: string; readonly reasons: readonly string[] }
> = new Map([
  [
    'dbgenerated-without-expression-optional',
    { column: '"public"."T"."list"', reasons: [NULLABLE_LIST] },
  ],
  [
    'enum-native',
    { column: '"public"."User"."roleList"', reasons: [NULLABLE_LIST, LOST_LIST_TYPE_PARAMS] },
  ],
  [
    'list-defaults',
    {
      column: '"public"."Lists"."bl"',
      reasons: [NULLABLE_LIST, 'the PSL source refuses a function default on a list column'],
    },
  ],
  [
    'native-types-accepted',
    {
      column: '"public"."NativeTypes"."varCharList"',
      reasons: [NULLABLE_LIST, LOST_LIST_TYPE_PARAMS],
    },
  ],
  [
    'number-default-spellings',
    { column: '"public"."Spellings"."mixed"', reasons: [NULLABLE_LIST] },
  ],
  [
    'number-defaults',
    { column: '"public"."Decimals"."list"', reasons: [NULLABLE_LIST, LOST_LIST_TYPE_PARAMS] },
  ],
  [
    'scalars',
    { column: '"public"."Scalars"."stringList"', reasons: [NULLABLE_LIST, LOST_LIST_TYPE_PARAMS] },
  ],
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

function serialize(contract: Contract<SqlStorage>): unknown {
  return JSON.parse(JSON.stringify(new PostgresContractSerializer().serializeContract(contract)));
}

async function roundTrip(caseName: string): Promise<void> {
  const schemaPath = prisma7SchemaPath(caseName);
  const prisma7 = await loadPrisma7Fixture(schemaPath, caseName);
  const printedContract = await loadPrintedPsl(printContractAsPsl(prisma7));

  expect(serialize(printedContract)).toEqual(serialize(prisma7));
  expect(printedContract.storage.storageHash).toBe(prisma7.storage.storageHash);
}

describe('a printed Prisma 7 contract reads back as the same contract', () => {
  for (const caseName of cases) {
    const refused = refusedListColumns.get(caseName);
    if (refused !== undefined) {
      it(`${caseName} is refused at ${refused.column} (${refused.reasons.join('; ')})`, async () => {
        await expect(roundTrip(caseName)).rejects.toMatchObject({
          code: 'CONTRACT.CONVERT_UNSUPPORTED',
          message: expect.stringContaining(refused.column),
        });
      });
      continue;
    }
    const reasons = expectedFailures.get(caseName);
    if (reasons !== undefined) {
      it.fails(`${caseName} (${reasons.join('; ')})`, async () => {
        await roundTrip(caseName);
      });
      continue;
    }
    it(caseName, async () => {
      await roundTrip(caseName);
    });
  }
});
