import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildSqlContractFromDefinition } from '@internal/sql-contract-ts/contract-builder';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import sqlitePack from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import {
  controlAdapter,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  sqliteTargetDescriptor,
  synthEdges,
  type TestDatabase,
} from './runner-fixtures';

const codecLookup = createSqliteBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'sqlite/text@1' } as const;

/** `User` in `table`, with an `id` primary key and a text column per entry of `fields`. */
export function userContract(
  table: string,
  fields: Readonly<Record<string, string>> = { email: 'email' },
): Contract<SqlStorage> {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
      models: [
        {
          modelName: 'User',
          tableName: table,
          fields: [
            { fieldName: 'id', columnName: 'id', descriptor: text, nullable: false },
            ...Object.entries(fields).map(([fieldName, columnName]) => ({
              fieldName,
              columnName,
              descriptor: text,
              nullable: false,
            })),
          ],
          id: { columns: ['id'] },
        },
      ],
    },
    codecLookup,
    dataTypeLookup,
  );
}

/** Plans and applies against a live SQLite database, as `db update` does. */
export function dbUpdateHarness(database: () => TestDatabase) {
  const query = (sql: string) => database().driver.query(sql);

  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: database().driver, contract: from });
    return sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: to,
      schema,
      policy: from === null ? INIT_ADDITIVE_POLICY : FULL_POLICY,
      fromContract: from,
      origin: from === null ? null : planOriginOf(from),
      statements,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
  }

  type PlanResult = Awaited<ReturnType<typeof plan>>;

  function success(result: PlanResult) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    return result;
  }

  async function labelsOf(result: PlanResult): Promise<readonly string[]> {
    return (await Promise.all(success(result).plan.operations)).map((op) => op.label);
  }

  async function apply(result: PlanResult, contract: Contract<SqlStorage>) {
    const { driver } = database();
    const executed = await sqliteTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: success(result).plan,
          migrationEdges: synthEdges(success(result).plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  /** Creates `contract`'s tables and two users in `table`. */
  async function start(contract: Contract<SqlStorage>, table = 'users'): Promise<void> {
    await apply(await plan(null, contract), contract);
    await query(
      `insert into "${table}" (id, email, name) values ('1', 'a@example.com', 'Ada'), ('2', 'b@example.com', 'Bo')`,
    );
  }

  async function rows(sql: string): Promise<unknown[]> {
    return (await query(sql)).rows;
  }

  return { query, plan, success, labelsOf, apply, start, rows };
}
