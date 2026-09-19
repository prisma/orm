import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { runSchemaVerify } from '../family.schema-verify.helpers';
import {
  authorSqlContractFromPsl,
  findStorageColumn,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const schema = `types {
  Money = Numeric(65, 30)
  Price = Numeric(10, 2)
}

model NumberDefault {
  id                  Int      @id
  long                Money    @default(12345678901234567890.123456789)
  tiny                Money    @default(0.000000000000000001)
  negative            Money    @default(-1.25)
  whole               Money    @default(10)
  scaledTrailingZeros Price    @default(1.50)
  bareTrailingZeros   Decimal  @default(1.50)
  bareLong            Decimal  @default(12345678901234567890.123456789)
  negativeZero        Decimal  @default(-0)
  leadingZeros        Decimal  @default(007)
  leadingZeroFraction Decimal  @default(00.10)
  big                 BigInt   @default(9007199254740993)
  smallestBig         BigInt   @default(-9223372036854775808)
  safeBig             BigInt   @default(42)
  decimals            Money[]  @default([12345678901234567890.123456789, -0.000000000000000001, 1.50])
  bareDecimals        Decimal[] @default([1.50, -0, 007])
  bigs                BigInt[] @default([9007199254740993, -1])
  count               Int      @default(-5)
  ratio               Float    @default(1.5)
}`;

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

const sqliteStack = createControlStack({ family: sql, target: sqlite, adapter: sqliteAdapter });

async function authorSqliteContractFromPsl(pslSchema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'psl-number-defaults-')), 'schema.prisma');
  writeFileSync(schemaPath, pslSchema, 'utf-8');
  return prismaContract(schemaPath, {
    target: sqlitePackRef,
    createNamespace: sqliteCreateNamespace,
  }).source.load({
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: sqliteStack.authoringContributions,
    codecLookup: sqliteStack.codecLookup,
    controlMutationDefaults: sqliteStack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: sqliteStack.capabilities,
  });
}

async function applyContract(connectionString: string, contract: Contract<SqlStorage>) {
  const familyInstance = sql.create(controlStack);
  const driver = await postgresDriver.create(connectionString);
  try {
    const planResult = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
      contract,
      schema: await familyInstance.introspect({ driver }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }
    const { plan } = planResult;
    const runResult = await postgres.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: postgresFrameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed: ${JSON.stringify(runResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe('PSL number defaults keep every digit', () => {
  it(
    'emits decimal and big integer defaults with every digit, applies them, and verifies strictly, while rounded ones mismatch',
    async () => {
      const authored = await authorSqlContractFromPsl(schema);
      expect(authored.diagnostics).toEqual([]);
      const contract = authored.contract;
      if (contract === undefined) throw new Error('authoring produced no contract');

      const defaultOf = (column: string) => findStorageColumn(contract, column)?.['default'];
      expect({
        long: defaultOf('long'),
        tiny: defaultOf('tiny'),
        negative: defaultOf('negative'),
        whole: defaultOf('whole'),
        scaledTrailingZeros: defaultOf('scaledTrailingZeros'),
        bareTrailingZeros: defaultOf('bareTrailingZeros'),
        bareLong: defaultOf('bareLong'),
        negativeZero: defaultOf('negativeZero'),
        leadingZeros: defaultOf('leadingZeros'),
        leadingZeroFraction: defaultOf('leadingZeroFraction'),
        big: defaultOf('big'),
        smallestBig: defaultOf('smallestBig'),
        safeBig: defaultOf('safeBig'),
        decimals: defaultOf('decimals'),
        bareDecimals: defaultOf('bareDecimals'),
        bigs: defaultOf('bigs'),
        count: defaultOf('count'),
        ratio: defaultOf('ratio'),
      }).toEqual({
        long: { kind: 'literal', value: '12345678901234567890.123456789' },
        tiny: { kind: 'literal', value: '0.000000000000000001' },
        negative: { kind: 'literal', value: '-1.25' },
        whole: { kind: 'literal', value: '10' },
        scaledTrailingZeros: { kind: 'literal', value: '1.50' },
        bareTrailingZeros: { kind: 'literal', value: '1.50' },
        bareLong: { kind: 'literal', value: '12345678901234567890.123456789' },
        negativeZero: { kind: 'literal', value: '0' },
        leadingZeros: { kind: 'literal', value: '7' },
        leadingZeroFraction: { kind: 'literal', value: '0.10' },
        big: { kind: 'literal', value: '9007199254740993' },
        smallestBig: { kind: 'literal', value: '-9223372036854775808' },
        safeBig: { kind: 'literal', value: '42' },
        decimals: {
          kind: 'literal',
          value: ['12345678901234567890.123456789', '-0.000000000000000001', '1.50'],
        },
        bareDecimals: { kind: 'literal', value: ['1.50', '0', '7'] },
        bigs: { kind: 'literal', value: ['9007199254740993', '-1'] },
        count: { kind: 'literal', value: -5 },
        ratio: { kind: 'literal', value: 1.5 },
      });

      const rounded = await authorSqlContractFromPsl(
        schema
          .replace('@default(12345678901234567890.123456789)', '@default(12345678901234567000)')
          .replace('Decimal  @default(1.50)', 'Decimal  @default(1.5)')
          .replace('@default(9007199254740993)', '@default(9007199254740992)'),
      );
      const roundedContract = rounded.contract;
      if (roundedContract === undefined) throw new Error('authoring produced no contract');

      const serializer = new PostgresContractSerializer();
      await withDevDatabase(async ({ connectionString }) => {
        await applyContract(connectionString, contract);

        const result = await runSchemaVerify(
          connectionString,
          serializer.serializeContract(contract),
          { strict: true },
        );
        expect(result.schema.issues).toEqual([]);
        expect(result.ok).toBe(true);

        const roundedResult = await runSchemaVerify(
          connectionString,
          serializer.serializeContract(roundedContract),
          { strict: true },
        );
        expect(roundedResult.schema.issues.map((issue) => issue.path.join('/')).sort()).toEqual([
          'database/public/NumberDefault/column:bareTrailingZeros/default',
          'database/public/NumberDefault/column:big/default',
          'database/public/NumberDefault/column:long/default',
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('PSL number defaults on codecs that do not hold numbers', () => {
  it('fail emit on a Postgres bytea column, as before', async () => {
    await expect(
      authorSqlContractFromPsl('model Payload {\n  id Int @id\n  data Bytes @default(1234)\n}'),
    ).rejects.toThrow('The first argument must be of type string');
  });

  it('fail emit on a SQLite datetime column, as before', async () => {
    await expect(
      authorSqliteContractFromPsl('model Event {\n  id Int @id\n  at DateTime @default(0)\n}'),
    ).rejects.toThrow('toISOString is not a function');
  });
});
