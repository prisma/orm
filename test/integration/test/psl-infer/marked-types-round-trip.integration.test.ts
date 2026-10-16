/**
 * Every Postgres data type with a constructor marked `inferred`, as a single column and as a list:
 * a planned migration creates the column, `contract infer` reads it back from the database, and the
 * inferred schema emits the same codec and data type parameters the authored schema did.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  type AuthoringTypeNamespace,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { dataTypeParams } from '@internal/framework-components/codec';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { printPsl } from '@internal/psl-printer';
import { isSqlDataType } from '@internal/sql-contract/data-type';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  postgresFrameworkComponents,
} from '../scalar-lists/psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

/** The data types whose constructor the stack marks `inferred`, found by walking every constructor. */
function dataTypesWithMarkedConstructor(namespace: AuthoringTypeNamespace): readonly string[] {
  return Object.values(namespace).flatMap((value) => {
    if (!isAuthoringTypeConstructorDescriptor(value)) return dataTypesWithMarkedConstructor(value);
    if (value.inferred !== true) return [];
    const dataType = controlStack.codecLookup.descriptorFor(value.output.codecId)?.dataType;
    return dataType === undefined ? [] : [dataType];
  });
}

/** Each marked constructor, bare and with arguments, as the authored schema writes it. */
const AUTHORED_TYPES = [
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Numeric',
  'Numeric(10)',
  'Numeric(10, 2)',
  'Json',
  'Jsonb',
  'Bytes',
  'SmallInt',
  'Real',
  'Char',
  'Char(5)',
  'VarChar',
  'VarChar(20)',
  'Uuid',
  'Inet',
  'DateString',
  'TimeString',
  'TimeString(3)',
  'Timetz',
  'Timetz(2)',
  'TimestampString',
  'TimestampString(3)',
  'TimestamptzString',
  'TimestamptzString(6)',
  'Bit',
  'Bit(8)',
  'VarBit',
  'VarBit(16)',
  'Interval',
  'Interval(3)',
] as const;

const AUTHORED_SCHEMA = `model Sample {
  id Int @id
${AUTHORED_TYPES.flatMap((type, index) => [`  c${index} ${type}`, `  l${index} ${type}[]`]).join('\n')}
}`;

async function resetDatabase(connectionString: string): Promise<void> {
  await withClient(connectionString, async (client) => {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
  });
}

async function migrateContract(
  connectionString: string,
  contract: Contract<SqlStorage>,
): Promise<void> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planResult = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }
    const runResult = await postgres.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
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

async function inferPsl(connectionString: string): Promise<string> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    return printPsl(await familyInstance.inferPslContract(schema), {
      pslBlockDescriptors: controlStack.authoringContributions.pslBlockDescriptors,
    });
  } finally {
    await driver.close();
  }
}

/** Each column's codec and normal-form data type parameters, keyed by column name. */
function columnTypes(contract: Contract<SqlStorage>): Record<string, unknown> {
  const types: Record<string, unknown> = {};
  for (const namespace of Object.values(contract.storage.namespaces)) {
    for (const table of Object.values(namespace.entries.table ?? {})) {
      for (const [name, column] of Object.entries(table.columns)) {
        const dataType = controlStack.dataTypes.lookup.get(column.dataType);
        if (dataType === undefined || !isSqlDataType(dataType)) {
          throw new Error(`column ${name} has no SQL data type`);
        }
        types[name] = {
          codecId: column.codecId,
          dataType: column.dataType,
          typeParams: dataType.sql.normalize(dataTypeParams(dataType, column.typeParams)),
          many: column.many !== undefined && column.many !== false,
        };
      }
    }
  }
  return types;
}

describe('contract infer over every Postgres data type with a marked constructor', {
  concurrent: false,
}, () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'emits the inferred schema to the codecs and parameters the authored schema had',
    async () => {
      if (!database) throw new Error('database not initialised');
      const authored = await authorSqlContractFromPsl(AUTHORED_SCHEMA);
      expect(authored.diagnostics).toEqual([]);
      if (!authored.contract) throw new Error('authoring produced no contract');
      const authoredDataTypes = Object.values(columnTypes(authored.contract)).map(
        (column) => (column as { readonly dataType: string }).dataType,
      );
      expect([...new Set([...authoredDataTypes, 'pg/enum'])].sort()).toEqual(
        [
          ...new Set(dataTypesWithMarkedConstructor(controlStack.authoringContributions.type)),
        ].sort(),
      );

      await resetDatabase(database.connectionString);
      await migrateContract(database.connectionString, authored.contract);
      const inferred = await inferPsl(database.connectionString);
      const reEmitted = await authorSqlContractFromPsl(
        inferred.replace(/^\/\/ use prisma-8\n/, ''),
      );
      expect(reEmitted.diagnostics).toEqual([]);
      if (!reEmitted.contract) throw new Error('the inferred schema produced no contract');

      expect(columnTypes(reEmitted.contract)).toEqual(columnTypes(authored.contract));
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'fails on a tsquery column, whose data type has no marked constructor',
    async () => {
      if (!database) throw new Error('database not initialised');
      await resetDatabase(database.connectionString);
      await withClient(database.connectionString, (client) =>
        client.query('CREATE TABLE search (id int4 PRIMARY KEY, query tsquery)'),
      );

      await expect(inferPsl(database.connectionString)).rejects.toMatchObject({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        meta: { columns: ['public.search.query: tsquery'] },
      });
    },
    timeouts.spinUpPpgDev,
  );
});
