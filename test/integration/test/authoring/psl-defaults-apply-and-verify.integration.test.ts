import { int4Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  sqlCharColumn,
  sqlFloatColumn,
  sqlIntColumn,
  sqlVarcharColumn,
} from '@internal/sql-relational-core/ast';
import { pgBitColumn, pgCharColumn } from '@internal/target-postgres/codecs';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  authorSqlContractFromPsl,
  findStorageColumn,
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
const planner = postgres.createPlanner(postgresAdapter.create(controlStack));

async function applyContract(
  driver: Awaited<ReturnType<typeof postgresControlDriver.create>>,
  contract: Contract<SqlStorage>,
) {
  const planResult = planner.plan({
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
  return postgres.createRunner(familyInstance).execute({
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
}

/** Applies a PSL schema to a new database, then verifies it and plans again against what was applied. */
async function applyAndVerify(
  schema: string,
  columns: readonly string[],
  options: { readonly strict: boolean } = { strict: false },
) {
  const authored = await authorSqlContractFromPsl(schema);
  return applyAndVerifyContract(authored.contract!, columns, options);
}

/** Applies a contract to a new database, then verifies it and plans again against what was applied. */
async function applyAndVerifyContract(
  contract: Contract<SqlStorage>,
  columns: readonly string[],
  options: { readonly strict: boolean },
) {
  const database = await createDevDatabase();
  const driver = await postgresControlDriver.create(database.connectionString);
  try {
    const applied = await applyContract(driver, contract);
    const introspected = await familyInstance.introspect({ driver, contract });
    const verified = familyInstance.verifySchema({
      contract,
      schema: introspected,
      strict: options.strict,
      frameworkComponents: postgresFrameworkComponents,
    });
    const replanned = planner.plan({
      contract,
      schema: introspected,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: contract,
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    return {
      defaults: columns.map((name) => findStorageColumn(contract, name)?.['default']),
      applied: applied.ok ? true : applied.failure,
      issues: verified.schema.issues,
      replannedOperations:
        replanned.kind === 'success'
          ? (await Promise.all(replanned.plan.operations)).map((op) => op.id)
          : replanned,
    };
  } finally {
    await driver.close();
    await database.close();
  }
}

describe('a Uuid default written in upper case or in braces', () => {
  it(
    'applies, then verifies against the database with no issue and plans no change',
    async () => {
      expect(
        await applyAndVerify(
          `
model Token {
  id     Int  @id
  upper  Uuid @default("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")
  braced Uuid @default("{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}")
}
`,
          ['upper', 'braced'],
        ),
      ).toEqual({
        defaults: [
          { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('a Char default with trailing spaces or a trailing tab', () => {
  it(
    'is stored and applied as written, then verifies with no issue and plans no change',
    async () => {
      expect(
        await applyAndVerify(
          `
model Tag {
  id     Int     @id
  spaced Char(3) @default("a  ")
  tabbed Char(3) @default("a\t")
}
`,
          ['spaced', 'tabbed'],
        ),
      ).toEqual({
        defaults: [
          { kind: 'literal', value: 'a  ' },
          { kind: 'literal', value: 'a\t' },
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('a Numeric default with a negative scale', () => {
  it(
    'applies on a single and a list column, then verifies strictly with no issue and plans no change',
    async () => {
      expect(
        await applyAndVerify(
          `
model Amount {
  id            Int              @id
  hundreds      Numeric(5, -2)   @default(12300)
  hundredsList  Numeric(5, -2)[] @default([100, -9999900]) @map("hundreds_list")
}
`,
          ['hundreds', 'hundreds_list'],
          { strict: true },
        ),
      ).toEqual({
        defaults: [
          { kind: 'literal', value: '12300' },
          { kind: 'literal', value: ['100', '-9999900'] },
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );
});

describe('a BigInt default past 2^53', () => {
  it(
    'applies on a single and a list column, then verifies strictly with no issue and plans no change',
    async () => {
      expect(
        await applyAndVerify(
          `
model Counter {
  id       Int      @id
  big      BigInt   @default(9007199254740993)
  small    BigInt   @default(-7)
  bigList  BigInt[] @default([9007199254740993, -1]) @map("big_list")
}
`,
          ['big', 'small', 'big_list'],
          { strict: true },
        ),
      ).toEqual({
        defaults: [
          { kind: 'literal', value: '9007199254740993' },
          { kind: 'literal', value: '-7' },
          { kind: 'literal', value: ['9007199254740993', '-1'] },
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );
});

/** `sql/char@1` as PostgreSQL names its column type, the way the PSL `Char` type writes it. */
const sqlCharacter = { codecId: 'sql/char@1', nativeType: 'character' } as const;

describe('a fixed-length column written without a length', () => {
  it(
    'in PSL, a bare Char with and without a default applies, verifies strictly and plans no change',
    async () => {
      expect(
        await applyAndVerify(
          `
model Flag {
  id      Int  @id
  bare    Char
  lettered Char @default("x")
}
`,
          ['bare', 'lettered'],
          { strict: true },
        ),
      ).toEqual({
        defaults: [undefined, { kind: 'literal', value: 'x' }],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'in TypeScript, bare sql/char@1, pg/char@1 and pg/bit@1 columns apply, verify strictly and plan no change',
    async () => {
      const contract = defineContract({
        models: {
          Flag: model('Flag', {
            fields: {
              id: field.column(int4Column).id(),
              sqlChar: field.column(sqlCharacter).column('sql_char'),
              pgChar: field.column(pgCharColumn()).column('pg_char').default('y'),
              pgBit: field.column(pgBitColumn()).column('pg_bit').default('1'),
            },
          }).sql({ table: 'flag' }),
        },
      }) as unknown as Contract<SqlStorage>;
      expect(
        await applyAndVerifyContract(contract, ['sql_char', 'pg_char', 'pg_bit'], { strict: true }),
      ).toEqual({
        defaults: [undefined, { kind: 'literal', value: 'y' }, { kind: 'literal', value: '1' }],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'in TypeScript, the family column helpers, whose native types are PostgreSQL aliases such as char and varchar, apply, verify strictly and plan no change',
    async () => {
      const contract = defineContract({
        models: {
          AliasRow: model('AliasRow', {
            fields: {
              id: field.column(int4Column).id(),
              bareChar: field.column(sqlCharColumn()).column('bare_char'),
              shortChar: field
                .column(sqlCharColumn({ length: 3 }))
                .column('short_char')
                .default('ab'),
              bareVarchar: field.column(sqlVarcharColumn()).column('bare_varchar'),
              shortVarchar: field
                .column(sqlVarcharColumn({ length: 10 }))
                .column('short_varchar')
                .default('hello'),
              count: field.column(sqlIntColumn()).column('count').default(7),
              ratio: field.column(sqlFloatColumn()).column('ratio').default(1.5),
            },
          }).sql({ table: 'alias_row' }),
        },
      }) as unknown as Contract<SqlStorage>;
      expect(
        await applyAndVerifyContract(
          contract,
          ['bare_char', 'short_char', 'bare_varchar', 'short_varchar', 'count', 'ratio'],
          { strict: true },
        ),
      ).toEqual({
        defaults: [
          undefined,
          { kind: 'literal', value: 'ab' },
          undefined,
          { kind: 'literal', value: 'hello' },
          { kind: 'literal', value: 7 },
          { kind: 'literal', value: 1.5 },
        ],
        applied: true,
        issues: [],
        replannedOperations: [],
      });
    },
    timeouts.spinUpPpgDev,
  );
});
