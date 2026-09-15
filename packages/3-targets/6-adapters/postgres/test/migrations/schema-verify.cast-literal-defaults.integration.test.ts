import {
  type ColumnDefaultLiteralInputValue,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

interface DefaultCase {
  readonly column: string;
  /**
   * The column definition. `prisma migrate diff` from Prisma 7.10.0 writes all of them except the
   * text columns, whose number defaults are hand-written DDL.
   */
  readonly ddl: string;
  readonly type: Omit<StorageColumnInput, 'default'>;
  readonly literal: ColumnDefaultLiteralInputValue;
  readonly differentLiteral: ColumnDefaultLiteralInputValue;
}

const int2 = { nativeType: 'int2', codecId: 'pg/int2@1', nullable: false } as const;
const int4 = { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } as const;
const int8 = { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false } as const;
const float8 = { nativeType: 'float8', codecId: 'pg/float8@1', nullable: false } as const;
const text = { nativeType: 'text', codecId: 'pg/text@1', nullable: false } as const;
const decimal = {
  nativeType: 'numeric',
  codecId: 'pg/numeric@1',
  nullable: false,
  typeParams: { precision: 65, scale: 30 },
} as const;
const unscaledDecimal = {
  nativeType: 'numeric',
  codecId: 'pg/numeric@1',
  nullable: false,
} as const;
const list = { nullable: true, many: true, noCheck: ['elementNotNull'] } as const;

const cases: readonly DefaultCase[] = [
  {
    column: 'negInt',
    ddl: '"negInt" INTEGER NOT NULL DEFAULT -1',
    type: int4,
    literal: -1,
    differentLiteral: -2,
  },
  {
    column: 'negSmallInt',
    ddl: '"negSmallInt" SMALLINT NOT NULL DEFAULT -2',
    type: int2,
    literal: -2,
    differentLiteral: -3,
  },
  {
    column: 'negFloat',
    ddl: '"negFloat" DOUBLE PRECISION NOT NULL DEFAULT -1.5',
    type: float8,
    literal: -1.5,
    differentLiteral: -2.5,
  },
  {
    column: 'negDecimal',
    ddl: '"negDecimal" DECIMAL(65,30) NOT NULL DEFAULT -0.5',
    type: decimal,
    literal: '-0.5',
    differentLiteral: '-0.6',
  },
  {
    column: 'negBigInt',
    ddl: '"negBigInt" BIGINT NOT NULL DEFAULT -9007199254740993',
    type: int8,
    literal: '-9007199254740993',
    differentLiteral: '-9007199254740992',
  },
  {
    column: 'longDecimal',
    ddl: '"longDecimal" DECIMAL(65,30) NOT NULL DEFAULT 12345678901234567890.123456789',
    type: decimal,
    literal: '12345678901234567890.123456789',
    differentLiteral: '12345678901234567000',
  },
  {
    column: 'tinyDecimal',
    ddl: '"tinyDecimal" DECIMAL(65,30) NOT NULL DEFAULT 0.000000000000000001',
    type: decimal,
    literal: '0.000000000000000001',
    differentLiteral: '0.000000000000000002',
  },
  {
    column: 'unscaledDecimal',
    ddl: '"unscaledDecimal" DECIMAL NOT NULL DEFAULT 1.50',
    type: unscaledDecimal,
    literal: '1.50',
    differentLiteral: '1.5',
  },
  {
    column: 'scaledDecimal',
    ddl: '"scaledDecimal" DECIMAL(10,2) NOT NULL DEFAULT 1.5',
    type: { ...decimal, typeParams: { precision: 10, scale: 2 } },
    literal: '1.50',
    differentLiteral: '1.51',
  },
  {
    column: 'negText',
    ddl: '"negText" TEXT NOT NULL DEFAULT -1',
    type: text,
    literal: '-1',
    differentLiteral: '-2',
  },
  {
    column: 'negVarchar',
    ddl: '"negVarchar" VARCHAR(10) NOT NULL DEFAULT -1.5',
    type: {
      nativeType: 'character varying',
      codecId: 'sql/varchar@1',
      nullable: false,
      typeParams: { length: 10 },
    },
    literal: '-1.5',
    differentLiteral: '1.5',
  },
  {
    column: 'negInts',
    ddl: '"negInts" INTEGER[] DEFAULT ARRAY[-1, 2]::INTEGER[]',
    type: { ...int4, ...list },
    literal: [-1, 2],
    differentLiteral: [-1, 3],
  },
  {
    column: 'bigInts',
    ddl: '"bigInts" BIGINT[] DEFAULT ARRAY[1, 2]::BIGINT[]',
    type: { ...int8, ...list },
    literal: ['1', '2'],
    differentLiteral: ['1', '3'],
  },
  {
    column: 'floats',
    ddl: '"floats" DOUBLE PRECISION[] DEFAULT ARRAY[1.5, 2]::DOUBLE PRECISION[]',
    type: { ...float8, ...list },
    literal: [1.5, 2],
    differentLiteral: [1.5, 3],
  },
  {
    column: 'decimals',
    ddl: '"decimals" DECIMAL(65,30)[] DEFAULT ARRAY[1.5]::DECIMAL(65,30)[]',
    type: { ...decimal, ...list },
    literal: ['1.5'],
    differentLiteral: ['2.5'],
  },
  {
    column: 'unscaledDecimals',
    ddl: '"unscaledDecimals" DECIMAL[] DEFAULT ARRAY[1.50]::DECIMAL[]',
    type: { ...unscaledDecimal, ...list },
    literal: ['1.50'],
    differentLiteral: ['1.5'],
  },
  {
    column: 'negTexts',
    ddl: '"negTexts" TEXT[] DEFAULT ARRAY[-1, 2]',
    type: { ...text, ...list },
    literal: ['-1', '2'],
    differentLiteral: ['-1', '3'],
  },
  {
    column: 'timestamps',
    ddl: `"timestamps" TIMESTAMP(3)[] DEFAULT ARRAY['2024-01-01 00:00:00 +00:00']::TIMESTAMP(3)[]`,
    type: {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: 3 },
      ...list,
    },
    literal: ['2024-01-01T00:00:00'],
    differentLiteral: ['2024-01-02T00:00:00'],
  },
  {
    column: 'emptyVarchars',
    ddl: '"emptyVarchars" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[]',
    type: {
      nativeType: 'character varying',
      codecId: 'sql/varchar@1',
      typeParams: { length: 32 },
      ...list,
    },
    literal: [],
    differentLiteral: ['a'],
  },
];

const table = 'Defaults';

const codecs = createPostgresBuiltinCodecLookup();

function readByCodec(codecId: string, value: ColumnDefaultLiteralInputValue): void {
  const codec = codecs.get(codecId);
  if (codec === undefined) throw new Error(`No codec ${codecId}`);
  for (const element of Array.isArray(value) ? value : [value]) codec.decodeJson(element);
}

function buildContract(
  defaultOf: (defaultCase: DefaultCase) => ColumnDefaultLiteralInputValue,
): Contract<SqlStorage> {
  const columns = Object.fromEntries(
    cases.map((defaultCase) => {
      const value = defaultOf(defaultCase);
      readByCodec(defaultCase.type.codecId, value);
      return [defaultCase.column, { ...defaultCase.type, default: { kind: 'literal', value } }];
    }),
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('cast-literal-defaults'),
    storage: new SqlStorage({
      storageHash: coreHash('cast-literal-defaults'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [table]: {
                columns: { id: int4, ...columns },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('schema verify of number, decimal and list defaults Postgres prints with a cast', {
  concurrent: false,
}, () => {
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
    const columnDdl = ['"id" INTEGER NOT NULL', ...cases.map((defaultCase) => defaultCase.ddl)];
    await driver.query(
      `CREATE TABLE "${table}" (${columnDdl.join(', ')}, CONSTRAINT "${table}_pkey" PRIMARY KEY ("id"))`,
    );
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function verifyPaths(contract: Contract<SqlStorage>): Promise<readonly string[]> {
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    return result.schema.issues.map((issue) => issue.path.join('/')).sort();
  }

  it('reports zero findings when the contract declares the same values as literals', {
    timeout: testTimeout,
  }, async () => {
    expect(await verifyPaths(buildContract((defaultCase) => defaultCase.literal))).toEqual([]);
  });

  it('reports a default mismatch on every column whose literal differs', {
    timeout: testTimeout,
  }, async () => {
    expect(await verifyPaths(buildContract((defaultCase) => defaultCase.differentLiteral))).toEqual(
      cases
        .map((defaultCase) => `database/public/${table}/column:${defaultCase.column}/default`)
        .sort(),
    );
  });
});
