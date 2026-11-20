import type { Contract } from '@internal/contract/types';
import { asNamespaceId } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  APP_SPACE_ID,
  type MigrationOperationPolicy,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import { buildBoundContract, enumType, member } from '@internal/sql-contract-ts/contract-builder';
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

const postgresTypeLookups = {
  codecLookup: createPostgresBuiltinCodecLookup(),
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
};

const FULL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

export function roleContract(
  members: Readonly<Record<string, string>>,
  options: { readonly required?: boolean; readonly default?: string } = {},
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a role needs a member');
  const Role = enumType(
    'Role',
    { codecId: 'pg/text@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Role }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: {
            id: f.column(type.String()).id(),
            role: withDefault(
              options.required === true ? f.namedType(Role) : f.namedType(Role).optional(),
              options.default,
            ),
          },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

function withDefault<TField extends { default(value: string): TField }>(
  field: TField,
  value: string | undefined,
): TField {
  return value === undefined ? field : field.default(value);
}

export function teamContract(
  members: Readonly<Record<string, string>>,
  options: { readonly legacy: boolean },
): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a role needs a member');
  const Role = enumType(
    'Role',
    { codecId: 'pg/text@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Role }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: { id: f.column(type.String()).id(), role: f.namedType(Role).optional() },
        }),
        Team: m('Team', {
          fields: { id: f.column(type.String()).id(), roles: f.namedType(Role).many() },
        }),
        ...(options.legacy
          ? {
              Legacy: m('Legacy', {
                fields: { id: f.column(type.String()).id(), role: f.namedType(Role).optional() },
              }),
            }
          : {}),
      },
    }),
  ) as Contract<SqlStorage>;
}

export function rankContract(members: Readonly<Record<string, number>>): Contract<SqlStorage> {
  const [first, ...rest] = Object.entries(members);
  if (first === undefined) throw new Error('a rank needs a member');
  const Rank = enumType(
    'Rank',
    { codecId: 'pg/int4@1' },
    member(first[0], first[1]),
    ...rest.map(([name, value]) => member(name, value)),
  );
  return buildBoundContract(
    sqlFamilyPack,
    postgresPack,
    { ...postgresTypeLookups, enums: { Rank }, createNamespace: postgresCreateNamespace },
    ({ field: f, model: m, type }) => ({
      models: {
        User: m('User', {
          fields: { id: f.column(type.String()).id(), rank: f.namedType(Rank).optional() },
        }),
      },
    }),
  ) as Contract<SqlStorage>;
}

export function renameRole(from: string, to: string): ResolvedMigrationStatement {
  return {
    kind: 'rename',
    entity: 'enumValue',
    from: { namespaceId: asNamespaceId('public'), enum: 'Role', member: from },
    to: { namespaceId: asNamespaceId('public'), enum: 'Role', member: to },
  };
}

/** Plans and applies stored value changes against a live Postgres database, with a `User` table holding roles. */
export function storedValueHarness(driverOf: () => PostgresControlDriver) {
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

  async function apply(result: PlanResult, contract: Contract<SqlStorage>) {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const driver = driverOf();
    const executed = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: result.plan,
          migrationEdges: synthEdges(result.plan),
          driver,
          destinationContract: contract,
          policy: FULL_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executed.ok) throw new Error(formatRunnerFailure(executed.failure));
  }

  /** Creates `contract`'s tables and three users: a guest, a user and one with no role. */
  async function start(contract: Contract<SqlStorage>): Promise<void> {
    await apply(await plan(null, contract), contract);
    await driverOf().query(
      `insert into "User" (id, role) values ('1', 'guest'), ('2', 'user'), ('3', null)`,
    );
  }

  async function roles(): Promise<unknown[]> {
    return (await driverOf().query('select id, role from "User" order by id')).rows;
  }

  async function operationKinds(result: PlanResult): Promise<readonly string[]> {
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = await Promise.all(result.plan.operations);
    return operations.map((operation) => operation.id.split('.')[0] ?? '');
  }

  return { plan, apply, start, roles, operationKinds };
}
