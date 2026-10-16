import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

const int4 = { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } as const;
const text = { many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } as const;
const table = 'Greetings';

function contractWith(defaults: Readonly<Record<string, string>>): Contract<SqlStorage> {
  const columns = Object.fromEntries(
    Object.entries(defaults).map(([column, expression]) => [
      column,
      { ...text, default: { kind: 'function', expression } },
    ]),
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('expression-default-text'),
    storage: new SqlStorage({
      storageHash: coreHash('expression-default-text'),
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

describe('schema verify of an expression default against the literal the database holds', {
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
    await driver.query(
      `CREATE TABLE "${table}" ("id" INTEGER NOT NULL, "same" TEXT NOT NULL DEFAULT 'hello'::text, "cased" TEXT NOT NULL DEFAULT 'hello'::text, "spaced" TEXT NOT NULL DEFAULT 'ab'::text, CONSTRAINT "${table}_pkey" PRIMARY KEY ("id"))`,
    );
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('reports a column whose literal differs only in case or in spaces inside the quotes', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractWith({
      same: "'hello'::text",
      cased: "'Hello'::text",
      spaced: "'a b'::text",
    });
    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const result = familyInstance.verifySchema({
      contract,
      schema,
      strict: true,
      frameworkComponents,
    });
    expect(result.schema.issues.map((issue) => issue.path.join('/')).sort()).toEqual([
      `database/public/${table}/column:cased/default`,
      `database/public/${table}/column:spaced/default`,
    ]);
  });
});
