import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY, type MigrationOperationPolicy } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumnInput } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const table = 'Shapes';

const TYPE_CHANGE_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function raw(sql: string, extra: Partial<StorageColumnInput> = {}): StorageColumnInput {
  return {
    dataType: 'sql/raw',
    codecId: 'sql/raw@1',
    typeParams: { sql },
    nullable: true,
    ...extra,
  };
}

function contractOf(columns: Record<string, StorageColumnInput>): Contract<SqlStorage> {
  const hash = JSON.stringify(columns);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(hash),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [table]: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  ...columns,
                },
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

describe('raw columns', { concurrent: false }, () => {
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
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function introspect(contract: Contract<SqlStorage>): Promise<SqlSchemaIRNode> {
    return familyInstance.introspect({ driver: driver!, contract });
  }

  function verify(contract: Contract<SqlStorage>, schema: SqlSchemaIRNode) {
    return familyInstance.verifySchema({ contract, schema, strict: true, frameworkComponents });
  }

  function plan(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy,
  ) {
    const planResult = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema,
      policy,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult, null, 2)}`);
    }
    return planResult.plan;
  }

  async function migrate(
    contract: Contract<SqlStorage>,
    schema: SqlSchemaIRNode,
    policy: MigrationOperationPolicy = INIT_ADDITIVE_POLICY,
  ) {
    const planned = plan(contract, schema, policy);
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver: driver!,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`runner failed:\n${formatRunnerFailure(result.failure)}`);
    return planned;
  }

  it('plans, migrates and verifies raw tsvector, circle and cidr columns with no findings', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractOf({
      search: raw('tsvector', { nullable: false }),
      area: raw('circle', { default: { kind: 'function', expression: "'<(0,0),1>'::circle" } }),
      net: raw('cidr'),
      nets: raw('cidr', { many: { elementNullable: false } }),
      code: raw('character varying(10)'),
    });
    await migrate(contract, emptySchema);

    await driver!.query(
      `INSERT INTO "${table}" ("id", "search", "net", "nets", "code") VALUES (1, $1, $2, $3, $4)`,
      ["'a':1 'b':2", '10.0.0.0/8', ['10.0.0.0/8', '192.168.0.0/16'], 'ten chars!'],
    );
    const { rows } = await driver!.query(
      `SELECT "search"::text, "area"::text, "net"::text, to_jsonb("nets"::text[]) AS "nets", "code" FROM "${table}"`,
    );
    const result = verify(contract, await introspect(contract));

    expect({ rows, ok: result.ok, issues: result.schema.issues }).toEqual({
      rows: [
        {
          search: "'a':1 'b':2",
          area: '<(0,0),1>',
          net: '10.0.0.0/8',
          nets: ['10.0.0.0/8', '192.168.0.0/16'],
          code: 'ten chars!',
        },
      ],
      ok: true,
      issues: [],
    });
  });

  it('verifies a raw type written as the catalog prints it, and reports another name for it', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TABLE "${table}" ("id" int4 PRIMARY KEY, "size" integer)`);
    const catalogName = contractOf({ size: raw('integer') });
    const alias = contractOf({ size: raw('int4') });

    const schema = await introspect(catalogName);
    const matching = verify(catalogName, schema);
    const mismatching = verify(alias, schema);

    expect({
      matching: matching.schema.issues,
      mismatching: mismatching.schema.issues.map((issue) => ({
        path: issue.path.join('/'),
        explanation: issue.explanation,
      })),
    }).toEqual({
      matching: [],
      mismatching: [
        {
          path: `database/public/${table}/column:size`,
          explanation:
            'The column type is "int4", but the database reports "integer". A type named by its catalog text is compared with the text the database reports, exactly.',
        },
      ],
    });
  });

  it('creates and verifies a raw type that lives outside public, found through the search_path', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('DROP SCHEMA IF EXISTS "extensions" CASCADE');
    await driver!.query('CREATE SCHEMA "extensions"');
    await driver!.query(`CREATE DOMAIN "extensions"."label" AS text CHECK (VALUE <> '')`);
    await driver!.query('SET search_path TO public, extensions');
    const contract = contractOf({ label: raw('label') });

    await migrate(contract, emptySchema);
    const result = verify(contract, await introspect(contract));

    expect(result.schema.issues).toEqual([]);
  });

  it('creates and verifies a raw domain off the search_path, named with its schema as the catalog prints it', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('DROP SCHEMA IF EXISTS "app" CASCADE');
    await driver!.query('CREATE SCHEMA "app"');
    await driver!.query(`CREATE DOMAIN "app"."email" AS text CHECK (VALUE LIKE '%@%')`);
    const contract = contractOf({ email: raw('app.email'), emails: raw('app.email[]') });

    await migrate(contract, emptySchema);
    const result = verify(contract, await introspect(contract));

    expect(result.schema.issues).toEqual([]);
  });

  it('rolls back a migration whose raw text adds a column clause, since verify then finds another type', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractOf({ size: raw('integer UNIQUE') });

    await expect(migrate(contract, emptySchema)).rejects.toThrow(/runner failed/);
    const { rows } = await driver!.query(
      `SELECT count(*)::int AS "tables" FROM information_schema.tables WHERE table_name = '${table}'`,
    );
    expect(rows).toEqual([{ tables: 0 }]);
  });

  it('plans a change from one raw type to another as ALTER COLUMN TYPE, whose check passes', {
    timeout: testTimeout,
  }, async () => {
    const before = contractOf({ search: raw('tsvector'), area: raw('circle') });
    const after = contractOf({ search: raw('text'), area: raw('character varying(40)') });
    await migrate(before, emptySchema);
    await driver!.query(`INSERT INTO "${table}" ("id", "search", "area") VALUES (1, $1, $2)`, [
      "'a':1",
      '<(1,2),3>',
    ]);

    const planned = await migrate(after, await introspect(after), TYPE_CHANGE_POLICY);
    const { rows } = await driver!.query(`SELECT "search", "area" FROM "${table}"`);
    const result = verify(after, await introspect(after));
    const operations = await Promise.all(planned.operations);

    expect({
      operations: operations.map((operation) => ({
        id: operation.id,
        postcheck: operation.postcheck.map((step) => step.description),
      })),
      rows,
      issues: result.schema.issues,
    }).toEqual({
      operations: [
        {
          id: `alterType.${table}.area`,
          postcheck: ['verify column "area" has type "character varying(40)"'],
        },
        {
          id: `alterType.${table}.search`,
          postcheck: ['verify column "search" has type "text"'],
        },
      ],
      rows: [{ search: "'a':1", area: '<(1,2),3>' }],
      issues: [],
    });
  });
});
