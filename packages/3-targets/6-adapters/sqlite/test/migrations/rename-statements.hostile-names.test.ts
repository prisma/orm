import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { CONTROL_TABLE_NAMES } from '@internal/target-sqlite/control-tables';
import type { SqlitePlanTargetDetails } from '@internal/target-sqlite/planner-target-details';
import { applicationDomainOf, timeouts } from '@repo/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};
const NAMESPACE = asNamespaceId(UNBOUND_NAMESPACE_ID);

interface Names {
  readonly model: string;
  readonly table: string;
  readonly field: string;
  readonly column: string;
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function contractOf(seed: string, names: Names): Contract<SqlStorage> {
  const integer = { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false };
  const text = { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false };
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({
      storageHash: coreHash(seed),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              [names.table]: {
                columns: { id: integer, [names.column]: text },
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
      models: {
        [names.model]: {
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/integer@1' } },
            [names.field]: { nullable: false, type: { kind: 'scalar', codecId: 'sqlite/text@1' } },
          },
          relations: {},
          storage: {
            table: names.table,
            namespaceId: UNBOUND_NAMESPACE_ID,
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

describe('rename statements with hostile identifiers on SQLite', {
  timeout: timeouts.databaseOperation,
}, () => {
  let testDb: TestDatabase;

  afterEach(() => {
    testDb?.cleanup();
  });

  async function userTables(): Promise<readonly string[]> {
    const tables = await testDb.driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name`,
    );
    return tables.rows.map((row) => row.name).filter((name) => !CONTROL_TABLE_NAMES.has(name));
  }

  it('renames a table and a column whose names hold a quote, a backslash, a space and a keyword', async () => {
    testDb = createTestDatabase();
    const { driver } = testDb;
    const from: Names = {
      model: 'Profile',
      table: 'user"s \\ select',
      field: 'email',
      column: 'e"mail \\ where',
    };
    const to: Names = {
      model: 'Person',
      table: 'pe"ople; drop table x; --',
      field: 'mail',
      column: 'ma"il \\ table',
    };
    const origin = contractOf('hostile-from', from);
    const destination = contractOf('hostile-to', to);
    const statements: readonly ResolvedMigrationStatement[] = [
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: NAMESPACE, model: from.model },
        to: { namespaceId: NAMESPACE, model: to.model },
      },
      {
        kind: 'rename',
        entity: 'field',
        from: { namespaceId: NAMESPACE, model: from.model, field: from.field },
        to: { namespaceId: NAMESPACE, model: to.model, field: to.field },
      },
    ];
    await driver.query(
      `CREATE TABLE ${quoted(from.table)} (id INTEGER PRIMARY KEY, ${quoted(from.column)} TEXT NOT NULL)`,
    );
    await driver.query(`INSERT INTO ${quoted(from.table)} VALUES (1, 'kept')`);
    expect(await userTables()).toEqual([from.table]);

    const planned = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: destination,
      schema: sqliteTargetDescriptor.migrations.contractToSchema(
        origin,
        frameworkComponents,
      ) as SqlSchemaIR,
      policy: ALL_CLASSES,
      fromContract: origin,
      origin: planOriginOf(origin),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
    const plan = createMigrationPlan<SqlitePlanTargetDetails>({
      targetId: 'sqlite',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: toPlanContractInfo(destination),
      operations: await Promise.all(planned.plan.operations),
      providedInvariants: [],
    });
    const result = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan,
          migrationEdges: synthEdges(plan),
          driver,
          destinationContract: destination,
          policy: ALL_CLASSES,
          frameworkComponents,
        },
      ],
    });

    expect(result.ok, result.ok ? '' : formatRunnerFailure(result.assertNotOk())).toBe(true);
    expect(await userTables()).toEqual([to.table]);
    const columns = await driver.query<{ name: string }>(
      'SELECT name FROM pragma_table_info(?) ORDER BY cid',
      [to.table],
    );
    expect(columns.rows).toEqual([{ name: 'id' }, { name: to.column }]);
    const rows = await driver.query(`SELECT * FROM ${quoted(to.table)}`);
    expect(rows.rows).toEqual([{ id: 1, [to.column]: 'kept' }]);
  });
});
