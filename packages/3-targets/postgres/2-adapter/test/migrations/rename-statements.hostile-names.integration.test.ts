import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const OLD_TABLE = 'user"s \\ select';
const NEW_TABLE = 'pe"ople \\ from';
const OLD_COLUMN = 'e"mail \\ where';
const NEW_COLUMN = 'ma"il \\ table';
const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function contractOf(
  seed: string,
  names: { model: string; table: string; field: string; column: string },
): Contract<SqlStorage> {
  const int4 = { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false };
  const text = { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        public: postgresCreateNamespace({
          id: 'public',
          entries: {
            table: {
              [names.table]: {
                columns: { id: int4, [names.column]: text },
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
    domain: applicationDomainOf({
      namespaceId: 'public',
      models: {
        [names.model]: {
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            [names.field]: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          relations: {},
          storage: {
            table: names.table,
            namespaceId: 'public',
            fields: { id: { column: 'id' }, [names.field]: { column: names.column } },
          },
        },
      },
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const PUBLIC = asNamespaceId('public');

function renameModel(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: PUBLIC, model: from },
    to: { namespaceId: PUBLIC, model: to },
  };
}

function renameField(
  fromModel: string,
  toModel: string,
  from: string,
  to: string,
): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'field',
    from: { namespaceId: PUBLIC, model: fromModel, field: from },
    to: { namespaceId: PUBLIC, model: toModel, field: to },
  };
}

describe('rename statements with hostile identifiers on Postgres', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
    driver = undefined;
  }, testTimeout);

  async function userTables(): Promise<readonly { schema: string; name: string }[]> {
    const tables = await driver!.query<{ schema: string; name: string }>(
      `select table_schema as schema, table_name as name from information_schema.tables
       where table_schema not in ('pg_catalog', 'information_schema', 'prisma_contract')
       order by 1, 2`,
    );
    return tables.rows;
  }

  async function renameThroughStatements(input: {
    readonly from: { model: string; table: string; field: string; column: string };
    readonly to: { model: string; table: string; field: string; column: string };
    readonly statements: readonly ResolvedMigrationStatement[];
  }) {
    const origin = contractOf('hostile-from', input.from);
    const destination = contractOf('hostile-to', input.to);
    await driver!.query(
      `create table "public".${quoted(input.from.table)} (id int4 primary key, ${quoted(input.from.column)} text not null)`,
    );
    await driver!.query(`insert into "public".${quoted(input.from.table)} values (1, 'kept')`);
    const tablesBefore = await userTables();
    expect(tablesBefore).toContainEqual({ schema: 'public', name: input.from.table });

    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: destination,
      schema: postgresTargetDescriptor.migrations.contractToSchema(
        origin,
        frameworkComponents,
      ) as SqlSchemaIRNode,
      policy: ALL_CLASSES,
      fromContract: origin,
      origin: planOriginOf(origin),
      statements: input.statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(destination),
      operations: await Promise.all(planned.plan.operations),
      providedInvariants: [],
    });
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver: driver!,
          destinationContract: destination,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });
    expect(result.ok, result.ok ? '' : formatRunnerFailure(result.assertNotOk())).toBe(true);

    expect(await userTables()).toEqual(
      tablesBefore.map((table) =>
        table.schema === 'public' && table.name === input.from.table
          ? { ...table, name: input.to.table }
          : table,
      ),
    );
    const columns = await driver!.query<{ name: string }>(
      `select column_name as name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by ordinal_position`,
      [input.to.table],
    );
    expect(columns.rows).toEqual([{ name: 'id' }, { name: input.to.column }]);
    const constraints = await driver!.query<{ name: string }>(
      'select conname as name from pg_constraint where conrelid = $1::regclass',
      [`"public".${quoted(input.to.table)}`],
    );
    expect(constraints.rows).toEqual([{ name: `${input.to.table}_pkey` }]);
    const rows = await driver!.query(`select * from "public".${quoted(input.to.table)}`);
    expect(rows.rows).toEqual([{ id: 1, [input.to.column]: 'kept' }]);
  }

  it('renames a table and a column whose names hold a quote, a backslash, a space and a keyword', {
    timeout: testTimeout,
  }, async () => {
    await renameThroughStatements({
      from: { model: 'Profile', table: OLD_TABLE, field: 'email', column: OLD_COLUMN },
      to: { model: 'Person', table: NEW_TABLE, field: 'mail', column: NEW_COLUMN },
      statements: [
        renameModel('Profile', 'Person'),
        renameField('Profile', 'Person', 'email', 'mail'),
      ],
    });
  });

  it('renames a column of a table whose name is written to inject SQL, and runs nothing else', {
    timeout: testTimeout,
  }, async () => {
    const table = 'p" add column "pwned" int; create table "pwned"(id int)--';
    await renameThroughStatements({
      from: { model: 'Post', table, field: 'email', column: 'email' },
      to: { model: 'Post', table, field: 'mail', column: 'mail' },
      statements: [renameField('Post', 'Post', 'email', 'mail')],
    });
  });
});
