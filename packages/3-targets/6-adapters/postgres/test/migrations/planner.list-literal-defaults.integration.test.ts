import {
  asNamespaceId,
  type ColumnDefault,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { PostgresNativeEnum, postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

interface ListDefaultCase {
  readonly column: string;
  readonly type: Omit<StorageColumnInput, 'default' | 'nullable' | 'many' | 'noCheck'>;
  readonly default: ColumnDefault;
}

const listDefaults: readonly ListDefaultCase[] = [
  {
    column: 'bigInts',
    type: { nativeType: 'int8', codecId: 'pg/int8@1' },
    default: { kind: 'literal', value: ['1', '-2', '9007199254740993'] },
  },
  {
    column: 'decimals',
    type: {
      nativeType: 'numeric',
      codecId: 'pg/numeric@1',
      typeParams: { precision: 65, scale: 30 },
    },
    default: { kind: 'literal', value: ['1.5', '-2.25', '12345678901234567890.123456789'] },
  },
  {
    column: 'unscaledDecimals',
    type: { nativeType: 'numeric', codecId: 'pg/numeric@1' },
    default: { kind: 'literal', value: ['1.50', '-0.5'] },
  },
  {
    column: 'timestamps',
    type: {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: 3 },
    },
    default: { kind: 'literal', value: ['2024-01-01T00:00:00', '2024-06-30T12:34:56.789'] },
  },
  {
    column: 'instants',
    type: {
      nativeType: 'timestamptz',
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: 3 },
    },
    default: { kind: 'literal', value: ['2024-01-01T00:00:00Z'] },
  },
  {
    column: 'dates',
    type: { nativeType: 'date', codecId: 'pg/date-temporal@1' },
    default: { kind: 'literal', value: ['2024-01-01'] },
  },
  {
    column: 'ints',
    type: { nativeType: 'int4', codecId: 'pg/int4@1' },
    default: { kind: 'literal', value: [-1, 2] },
  },
  {
    column: 'floats',
    type: { nativeType: 'float8', codecId: 'pg/float8@1' },
    default: { kind: 'literal', value: [1.5, -2] },
  },
  {
    column: 'texts',
    type: { nativeType: 'text', codecId: 'pg/text@1' },
    default: { kind: 'literal', value: ['a,b', "it's", '-1'] },
  },
  {
    column: 'emptyVarchars',
    type: { nativeType: 'character varying', codecId: 'sql/varchar@1', typeParams: { length: 32 } },
    default: { kind: 'literal', value: [] },
  },
  {
    column: 'castBigInts',
    type: { nativeType: 'int8', codecId: 'pg/int8@1' },
    default: { kind: 'function', expression: 'ARRAY[(1)::bigint, (2)::bigint]' },
  },
  {
    column: 'castTimestamps',
    type: {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: 3 },
    },
    default: { kind: 'function', expression: "ARRAY['2024-01-01 00:00:00']::TIMESTAMP(3)[]" },
  },
  {
    column: 'castBytes',
    type: { nativeType: 'bytea', codecId: 'pg/bytea@1' },
    default: { kind: 'function', expression: "ARRAY['\\x68656c6c6f']::BYTEA[]" },
  },
];

interface EnumList {
  readonly column: string;
  readonly entityName: string;
  readonly typeName: string;
  readonly members: readonly string[];
}

const publicSchema = 'public';
const auditSchema = 'audit';

const publicEnumLists: readonly EnumList[] = [
  { column: 'sortOrders', entityName: 'SortOrder', typeName: 'order', members: ['asc', 'desc'] },
  { column: 'spacedNames', entityName: 'Spaced', typeName: 'my enum', members: ['a b', 'c'] },
  { column: 'quotedNames', entityName: 'Quoted', typeName: 'my"enum', members: ['x', 'y'] },
];

const auditEnumList: EnumList = {
  column: 'actions',
  entityName: 'AuditAction',
  typeName: 'AuditAction',
  members: ['CREATE', 'DELETE'],
};

function enumListColumns(
  schema: string,
  enumLists: readonly EnumList[],
  withDefaults: boolean,
): Record<string, StorageColumnInput> {
  return Object.fromEntries(
    enumLists.map((enumList): [string, StorageColumnInput] => {
      const nativeType =
        schema === publicSchema ? enumList.typeName : `${schema}.${enumList.typeName}`;
      return [
        enumList.column,
        {
          nativeType,
          codecId: 'pg/enum@1',
          nullable: true,
          many: true,
          noCheck: ['elementNotNull'],
          typeParams: { typeName: nativeType },
          valueSet: {
            plane: 'storage',
            entityKind: 'valueSet',
            namespaceId: schema,
            entityName: enumList.entityName,
          },
          ...(withDefaults ? { default: { kind: 'literal', value: [...enumList.members] } } : {}),
        },
      ];
    }),
  );
}

function enumEntries(enumLists: readonly EnumList[]) {
  return {
    native_enum: Object.fromEntries(
      enumLists.map((enumList) => [
        enumList.entityName,
        new PostgresNativeEnum({ typeName: enumList.typeName, members: [...enumList.members] }),
      ]),
    ),
    valueSet: Object.fromEntries(
      enumLists.map((enumList) => [
        enumList.entityName,
        { kind: 'valueSet', values: [...enumList.members] },
      ]),
    ),
  };
}

function auditNamespace(withDefaults: boolean) {
  return postgresCreateNamespace({
    id: asNamespaceId(auditSchema),
    entries: {
      table: {
        AuditLog: {
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            ...enumListColumns(auditSchema, [auditEnumList], withDefaults),
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
      ...enumEntries([auditEnumList]),
    },
  });
}

const codecs = createPostgresBuiltinCodecLookup();

function assertCodecReadsLiteral(defaultCase: ListDefaultCase): void {
  if (defaultCase.default.kind !== 'literal' || !Array.isArray(defaultCase.default.value)) return;
  const codec = codecs.get(defaultCase.type.codecId);
  if (codec === undefined) throw new Error(`no codec ${defaultCase.type.codecId}`);
  for (const element of defaultCase.default.value) codec.decodeJson(element);
}

function buildContract(withDefaults: boolean): Contract<SqlStorage> {
  const columns = Object.fromEntries(
    listDefaults.map((defaultCase) => {
      assertCodecReadsLiteral(defaultCase);
      return [
        defaultCase.column,
        {
          ...defaultCase.type,
          nullable: true,
          many: true,
          noCheck: ['elementNotNull'],
          ...(withDefaults ? { default: defaultCase.default } : {}),
        },
      ];
    }),
  );
  const hash = withDefaults ? 'list-literal-defaults' : 'list-columns-without-defaults';
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [publicSchema]: postgresCreateNamespace({
          id: asNamespaceId(publicSchema),
          entries: {
            table: {
              Lists: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  ...columns,
                  ...enumListColumns(publicSchema, publicEnumLists, withDefaults),
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            ...enumEntries(publicEnumLists),
          },
        }),
        [auditSchema]: auditNamespace(withDefaults),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const additiveAndWidening: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening'],
};

describe('planned list defaults apply and verify', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await driver.query(`DROP SCHEMA IF EXISTS "${auditSchema}" CASCADE`);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function planAndApply(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy,
  ): Promise<void> {
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema,
      policy,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    const runner = postgresTargetDescriptor.createRunner(familyInstance);
    const executeResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: planResult.plan.spaceId ?? APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
    }
  }

  async function strictVerifyPaths(contract: Contract<SqlStorage>): Promise<readonly string[]> {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    return result.schema.issues.map((issue) => issue.path.join('/'));
  }

  it('creates a table whose list defaults verify with zero findings', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildContract(true);

    await planAndApply(contract, emptySchema, INIT_ADDITIVE_POLICY);

    expect(await strictVerifyPaths(contract)).toEqual([]);
  });

  it('sets list defaults on existing columns that then verify with zero findings', {
    timeout: testTimeout,
  }, async () => {
    await planAndApply(buildContract(false), emptySchema, INIT_ADDITIVE_POLICY);
    const contract = buildContract(true);

    await planAndApply(
      contract,
      await familyInstance.introspect({ driver: driver!, contract }),
      additiveAndWidening,
    );

    expect(await strictVerifyPaths(contract)).toEqual([]);
  });
});
