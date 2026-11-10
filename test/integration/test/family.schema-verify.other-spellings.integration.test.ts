/**
 * A table built by raw SQL with other spellings of each type the contract names: `db verify` is clean, and the planner, with every operation class allowed, plans no operation. Columns are compared by the data type that claims the type the database reports and its parameters in normal form, so no spelling makes a spurious `ALTER COLUMN TYPE`.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  issueOutcome,
} from '@internal/framework-components/control';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import postgres from '@internal/target-postgres/control';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import {
  applicationDomainOf,
  createDevDatabase,
  type DevDatabase,
  timeouts,
} from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [pgvector],
});
const familyInstance = sql.create(controlStack);
const frameworkComponents = [postgres, postgresAdapter, postgresControlDriver, pgvector] as const;

const column = (
  dataType: string,
  codecId: string,
  typeParams?: Record<string, unknown>,
): StorageColumnInput => ({
  dataType,
  codecId,
  nullable: true,
  ...(typeParams === undefined ? {} : { typeParams }),
});

const CREATE_TABLE = `
  CREATE SCHEMA app;
  CREATE TYPE app.status AS ENUM ('on', 'off');
  CREATE SCHEMA extensions;
  CREATE EXTENSION vector SCHEMA extensions;
  CREATE TABLE public.t (
    id int PRIMARY KEY,
    count integer,
    name character varying(20),
    created timestamp(3) with time zone,
    amount numeric(10,0),
    code character(1),
    ratio double precision,
    grid int[][],
    status app.status,
    embedding extensions.vector(3)
  );
`;

const contract: Contract<SqlStorage> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('other-spellings'),
  storage: new SqlStorage({
    storageHash: coreHash('other-spellings'),
    namespaces: {
      public: postgresCreateNamespace({
        id: 'public',
        entries: {
          table: {
            t: {
              columns: {
                id: { ...column('pg/int4', 'pg/int4@1'), nullable: false },
                count: column('pg/int4', 'pg/int4@1'),
                name: column('pg/varchar', 'pg/varchar@1', { length: 20 }),
                created: column('pg/timestamptz', 'pg/timestamptz-string@1', { precision: 3 }),
                amount: column('pg/numeric', 'pg/numeric@1', { precision: 10 }),
                code: column('pg/char', 'pg/char@1'),
                ratio: column('pg/float8', 'pg/float8@1'),
                grid: { ...column('pg/int4', 'pg/int4@1'), many: { elementNullable: true } },
                status: column('pg/enum', 'pg/enum@1', { typeName: 'app.status' }),
                embedding: column('pgvector/vector', 'pg/vector@1', { length: 3 }),
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      }),
      app: postgresCreateNamespace({
        id: 'app',
        entries: {
          native_enum: {
            status: { kind: 'postgres-enum', typeName: 'status', members: ['on', 'off'] },
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

describe('a table built with other spellings of each type', () => {
  let database: DevDatabase;

  beforeAll(async () => {
    database = await createDevDatabase();
    const driver = await postgresControlDriver.create(database.connectionString);
    try {
      await driver.query(CREATE_TABLE);
    } finally {
      await driver.close();
    }
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await database?.close();
  });

  it(
    'verifies clean, and the planner plans no operation',
    async () => {
      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const schema = await familyInstance.introspect({ driver, contract });
        const verify = familyInstance.verifySchema({
          contract,
          schema,
          strict: false,
          frameworkComponents,
        });
        const plan = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
          contract,
          schema,
          policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
          fromContract: null,
          origin: null,
          statements: [],
          frameworkComponents,
          spaceId: APP_SPACE_ID,
          snapshotsImportPath: '../../snapshots',
        });
        if (plan.kind !== 'success') throw new Error(`planner failed: ${JSON.stringify(plan)}`);
        const operations = await Promise.all(plan.plan.operations);
        expect({
          issues: verify.schema.issues.map((issue) => ({
            outcome: issueOutcome(issue),
            path: issue.path.join('/'),
          })),
          operations: operations.map((operation) => operation.id),
        }).toEqual({ issues: [], operations: [] });
      } finally {
        await driver.close();
      }
    },
    timeouts.spinUpPpgDev,
  );
});
