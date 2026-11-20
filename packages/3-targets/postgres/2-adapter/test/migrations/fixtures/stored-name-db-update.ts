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
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import {
  controlAdapter,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  synthEdges,
} from './runner-fixtures';

const codecLookup = createPostgresBuiltinCodecLookup();
const dataTypeLookup = createDataTypeLookup(postgresDataTypes);

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

const text = { codecId: 'pg/text@1' } as const;

interface ModelSpec {
  readonly table: string;
  /** The column of each field other than `id`, keyed by field name. */
  readonly fields: Readonly<Record<string, string>>;
}

/** One model per entry, in its table, with an `id` primary key and a text column per field. */
export function contractOf(models: Readonly<Record<string, ModelSpec>>): Contract<SqlStorage> {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models: Object.entries(models).map(([modelName, { table, fields }]) => ({
        modelName,
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
      })),
    },
    codecLookup,
    dataTypeLookup,
  );
}

/** `User` in `table`, with an `id` primary key and a text column per entry of `fields`. */
export function userContract(
  table: string,
  fields: Readonly<Record<string, string>> = { email: 'email' },
): Contract<SqlStorage> {
  return contractOf({ User: { table, fields } });
}

/** Plans and applies against a live Postgres database, as `db update` does. */
export function dbUpdateHarness(driverOf: () => PostgresControlDriver) {
  async function plan(
    from: Contract<SqlStorage> | null,
    to: Contract<SqlStorage>,
    statements: readonly ResolvedMigrationStatement[] = [],
  ) {
    const schema =
      from === null
        ? emptySchema
        : await familyInstance.introspect({ driver: driverOf(), contract: from });
    return postgresTargetDescriptor.createPlanner(controlAdapter).plan({
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
    const driver = driverOf();
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
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

  /** Creates `contract`'s tables and two users in table `users`. */
  async function start(contract: Contract<SqlStorage>): Promise<void> {
    await apply(await plan(null, contract), contract);
    await driverOf().query(
      `insert into "users" (id, email, name) values ('1', 'a@example.com', 'Ada'), ('2', 'b@example.com', 'Bo')`,
    );
  }

  async function rows(query: string): Promise<unknown[]> {
    return (await driverOf().query(query)).rows;
  }

  return { plan, success, labelsOf, apply, start, rows };
}
