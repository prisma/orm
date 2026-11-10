/**
 * `contract infer` writes each integer, decimal, float, text, boolean and binary column as the convenience type that gives its explicit type, with only the arguments that differ from the defaults. The inferred schema emits, verifies clean against the database it was read from, and plans no migration.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
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

const ACCOUNT_TABLE = `CREATE TABLE account (
  id       int4 PRIMARY KEY,
  visits   int2 NOT NULL,
  total    int4 NOT NULL,
  balance  int8 NOT NULL,
  price    numeric NOT NULL,
  priced   numeric(10, 2) NOT NULL,
  small    float4 NOT NULL,
  ratio    float8 NOT NULL,
  name     text NOT NULL,
  code     varchar(12) NOT NULL,
  initials char(3) NOT NULL,
  active   bool NOT NULL DEFAULT true,
  avatar   bytea NOT NULL
)`;

function fieldLines(printed: string): readonly string[] {
  return printed
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) =>
      /^(visits|total|balance|price|priced|small|ratio|name|code|initials|active|avatar) /.test(
        line,
      ),
    );
}

describe('contract infer over integer, decimal, float, text, boolean and binary columns', {
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
    'writes the convenience types, which emit, verify clean and plan no migration',
    async () => {
      if (!database) throw new Error('database not initialised');
      await withClient(database.connectionString, async (client) => {
        await client.query(ACCOUNT_TABLE);
      });
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const schema = await familyInstance.introspect({ driver });
        const inferred = printPsl(await familyInstance.inferPslContract(schema), {
          pslBlockDescriptors: controlStack.authoringContributions.pslBlockDescriptors,
        });
        expect(fieldLines(inferred)).toEqual([
          'visits Int(storage: int2)',
          'total Int',
          'balance BigInt',
          'price Decimal',
          'priced Decimal(precision: 10, scale: 2)',
          'small Float(storage: float4)',
          'ratio Float',
          'name String',
          'code String(storage: varchar, length: 12)',
          'initials String(storage: char, length: 3)',
          'active Boolean @default(true)',
          'avatar Bytes',
        ]);

        const emitted = await authorSqlContractFromPsl(
          inferred.replace(/^\/\/ use prisma-8\n/, ''),
        );
        expect(emitted.diagnostics).toEqual([]);
        const contract = emitted.contract;
        if (!contract) throw new Error('the inferred schema produced no contract');

        const verified = familyInstance.verifySchema({
          contract,
          schema: await familyInstance.introspect({ driver, contract }),
          strict: true,
          frameworkComponents: postgresFrameworkComponents,
        });
        expect(verified.schema.issues).toEqual([]);

        const planned = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
          contract,
          schema: await familyInstance.introspect({ driver, contract }),
          policy: INIT_ADDITIVE_POLICY,
          fromContract: null,
          origin: null,
          statements: [],
          frameworkComponents: postgresFrameworkComponents,
          spaceId: APP_SPACE_ID,
          snapshotsImportPath: '../../snapshots',
        });
        expect(planned.kind === 'success' ? planned.plan.operations : planned).toEqual([]);
      } finally {
        await driver.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
