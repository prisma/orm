import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import {
  APP_SPACE_ID,
  planOriginOf,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { expectDataLossMatchesDestructive } from '@repo/test-utils/data-loss-expectations';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { postgresContractToSchema } from '../../src/core/migrations/postgres-contract-to-schema';
import { PostgresRlsEnablement } from '../../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { postgresTypeComponents } from '../postgres-type-lookups';
import { emailIndex } from './rename-column-fixtures';

const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] as const,
};
const unbound = asNamespaceId(UNBOUND_NAMESPACE_ID);

const columnTypes = {
  int4: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
  int8: { dataType: 'pg/int8', codecId: 'pg/int8@1', nullable: false },
  text: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
  'text?': { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true },
} as const;

interface TableSpec {
  readonly columns: Readonly<Record<string, keyof typeof columnTypes>>;
  /** The `using` of the table's one policy, which also turns on row-level security. */
  readonly policy?: string;
  /** A column with an index named after the table. */
  readonly indexed?: string;
  /** The hash of the policy's generated (wire) name; without it the policy has an exact name. */
  readonly policyHash?: string;
}

function policyOn(table: string, using: string, hash: string | undefined): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming:
      hash === undefined
        ? { kind: 'exact', name: `${table} readers` }
        : { kind: 'wire', prefix: `${table}_readers`, hash },
    tableName: table,
    namespaceId: 'public',
    operation: 'select',
    roles: ['app_user'],
    using,
    permissive: true,
    withCheck: undefined,
  });
}

/** A model per table, named as the table, each field stored in the column of the same name. */
function contract(seed: string, tables: Readonly<Record<string, TableSpec>>): Contract<SqlStorage> {
  const specs = Object.entries(tables);
  const policies = specs.flatMap(([table, spec]) =>
    spec.policy === undefined ? [] : [policyOn(table, spec.policy, spec.policyHash)],
  );
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: Object.fromEntries(
        specs.map(([table, spec]) => [
          table,
          new StorageTable({
            columns: Object.fromEntries(
              Object.entries(spec.columns).map(([column, type]) => [column, columnTypes[type]]),
            ),
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: spec.indexed === undefined ? [] : [emailIndex(table, spec.indexed)],
          }),
        ]),
      ),
      policy: Object.fromEntries(policies.map((policy) => [policy.name, policy])),
      rls: Object.fromEntries(
        policies.map((policy) => [
          policy.tableName,
          new PostgresRlsEnablement({ tableName: policy.tableName, namespaceId: 'public' }),
        ]),
      ),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash(seed),
    storage: new SqlStorage({ storageHash: coreHash(seed), namespaces: { public: schema } }),
    roots: {},
    domain: applicationDomainOf({
      models: Object.fromEntries(
        specs.map(([table, spec]) => [
          table,
          {
            fields: Object.fromEntries(
              Object.keys(spec.columns).map((column) => [
                column,
                { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              ]),
            ),
            relations: {},
            storage: {
              table,
              namespaceId: 'public',
              fields: Object.fromEntries(
                Object.keys(spec.columns).map((column) => [column, { column }]),
              ),
            },
          },
        ]),
      ),
    }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function planned(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
  fromContract: Contract<SqlStorage> | null = from,
  statements: readonly ResolvedMigrationStatement[] = [],
  frameworkComponents: typeof postgresTypeComponents = postgresTypeComponents,
) {
  const result = createPostgresMigrationPlanner(stubLowerer).plan({
    contract: to,
    schema: postgresContractToSchema(from, postgresTypeComponents),
    policy: ALL_CLASSES,
    fromContract,
    origin: planOriginOf(fromContract),
    statements,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  const settled = await Promise.allSettled(result.plan.operations);
  expectDataLossMatchesDestructive(
    result,
    settled.map((entry) =>
      entry.status === 'fulfilled' ? entry.value : { operationClass: 'data' },
    ),
  );
  const labels = settled.map((entry) =>
    entry.status === 'fulfilled' ? entry.value.label : 'placeholder',
  );
  const labelled = (entries: typeof result.dataLoss) =>
    entries.map(({ operationIndex, subject }) => ({
      operation: labels[operationIndex],
      subject,
    }));
  return {
    labels,
    dataLoss: labelled(result.dataLoss),
    accessWidening: labelled(result.accessWidening),
  };
}

describe('Postgres planner, data loss', () => {
  it('names the model of a dropped table and the field of a dropped column', async () => {
    const from = contract('from', {
      Legacy: { columns: { id: 'int4' } },
      User: { columns: { id: 'int4', nickname: 'text' } },
    });
    const to = contract('to', { User: { columns: { id: 'int4' } } });

    expect((await planned(from, to)).dataLoss).toEqual([
      {
        operation: 'Drop table "Legacy"',
        subject: { kind: 'model', namespaceId: unbound, model: 'Legacy' },
      },
      {
        operation: 'Drop column "nickname" from "User"',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
    ]);
  });

  it('names the field a destructive codec-hook call is about, after the control-policy partition', async () => {
    const from = contract('from', { User: { columns: { id: 'int4', nickname: 'text' } } });
    const to = contract('to', { User: { columns: { id: 'int4' } } });
    const nickname = { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' };

    const plan = await planned(
      from,
      to,
      from,
      [],
      withFieldHook(postgresTypeComponents, 'dropped', 'destructive'),
    );

    expect(plan.dataLoss).toEqual([
      { operation: 'Drop column "nickname" from "User"', subject: nickname },
      { operation: 'Codec hook for dropped User.nickname', subject: nickname },
    ]);
  });

  it('names the field of a type change that can change values, and not of a safe widening', async () => {
    const from = contract('from', {
      User: { columns: { id: 'int4', age: 'text', score: 'int4' } },
    });
    const to = contract('to', { User: { columns: { id: 'int4', age: 'int4', score: 'int8' } } });

    expect((await planned(from, to)).dataLoss).toEqual([
      {
        operation: 'Alter type of "User"."age" to int4',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
      },
    ]);
  });

  it('names storage by its schema-qualified name when the plan has no origin contract', async () => {
    const from = contract('from', {
      Legacy: { columns: { id: 'int4' } },
      User: { columns: { id: 'int4', nickname: 'text' } },
    });
    const to = contract('to', { User: { columns: { id: 'int4' } } });

    expect((await planned(from, to, null)).dataLoss.map(({ subject }) => subject)).toEqual([
      { kind: 'storage', name: 'public.Legacy' },
      { kind: 'storage', name: 'public.User.nickname' },
    ]);
  });

  it('lists a policy drop and disabling row-level security as widening access to the model', async () => {
    const from = contract('from', {
      User: { columns: { id: 'int4' }, policy: 'true' },
    });
    const to = contract('to', { User: { columns: { id: 'int4' } } });
    const { dataLoss, accessWidening } = await planned(from, to);

    const user = { kind: 'model', namespaceId: unbound, model: 'User' };
    expect({ dataLoss, accessWidening }).toEqual({
      dataLoss: [],
      accessWidening: [
        { operation: 'Disable row-level security on "User"', subject: user },
        { operation: 'Drop RLS policy "User readers" on "User"', subject: user },
      ],
    });
  });

  it('leaves out the drop of a generated-name policy the plan replaces under a new hash', async () => {
    const from = contract('from', {
      User: { columns: { id: 'int4' }, policy: 'true', policyHash: 'aaaaaaaa' },
    });
    const to = contract('to', {
      User: { columns: { id: 'int4' }, policy: 'false', policyHash: 'bbbbbbbb' },
    });

    const { labels, accessWidening } = await planned(from, to);
    expect(labels).toEqual(
      expect.arrayContaining([expect.stringContaining('User_readers_aaaaaaaa')]),
    );
    expect(accessWidening).toEqual([]);
  });

  it('lists the drop of a generated-name policy the plan does not replace', async () => {
    const from = contract('from', {
      User: { columns: { id: 'int4' }, policy: 'true', policyHash: 'aaaaaaaa' },
    });
    const to = contract('to', { User: { columns: { id: 'int4' } } });

    const { accessWidening } = await planned(from, to);
    expect(accessWidening.map(({ operation }) => operation)).toEqual(
      expect.arrayContaining([expect.stringContaining('User_readers_aaaaaaaa')]),
    );
  });

  it('leaves out the drop of a policy the plan replaces', async () => {
    const from = contract('from', { User: { columns: { id: 'int4' }, policy: 'true' } });
    const to = contract('to', { User: { columns: { id: 'int4' }, policy: 'false' } });

    const { dataLoss, accessWidening } = await planned(from, to);
    expect({ dataLoss, accessWidening }).toEqual({ dataLoss: [], accessWidening: [] });
  });

  it('names the origin model and fields of a table a statement renamed earlier in the plan', async () => {
    const from = contract('from', {
      User: {
        columns: { id: 'int4', handle: 'text', nickname: 'text', age: 'text' },
        indexed: 'handle',
      },
    });
    const to = contract('to', {
      Account: { columns: { id: 'int4', handle: 'text', age: 'int4' }, indexed: 'handle' },
    });
    const renameUser: ResolvedMigrationStatement = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: unbound, model: 'User' },
      to: { namespaceId: unbound, model: 'Account' },
    };

    const result = await planned(from, to, from, [renameUser]);

    expect(result.labels).toEqual([
      'Rename table "User" to "Account"',
      'Rename primary key "User_pkey" to "Account_pkey" on "Account"',
      expect.stringMatching(/^Rename index "User_handle_idx_\w+" to "Account_handle_idx_\w+"/),
      'Drop column "nickname" from "Account"',
      'placeholder',
      'Alter type of "Account"."age" to int4',
    ]);
    expect(result.dataLoss).toEqual([
      {
        operation: 'Drop column "nickname" from "Account"',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'nickname' },
      },
      {
        operation: 'Alter type of "Account"."age" to int4',
        subject: { kind: 'field', namespaceId: unbound, model: 'User', field: 'age' },
      },
    ]);
  });
});

/** A codec hook that adds an operation of `operationClass` for every field of the `on` event. */
function withFieldHook(
  components: typeof postgresTypeComponents,
  on: 'added' | 'dropped',
  operationClass: 'additive' | 'destructive',
): typeof postgresTypeComponents {
  const hooks: CodecControlHooks = {
    onFieldEvent: (event, ctx) =>
      event === on
        ? [
            {
              factoryName: 'codecHook',
              operationClass,
              label: `Codec hook for ${on} ${ctx.tableName}.${ctx.fieldName}`,
              renderTypeScript: () => 'codecHook()',
              importRequirements: () => [],
              toOp: () => ({
                id: `codec.${on}.${ctx.tableName}.${ctx.fieldName}`,
                label: `Codec hook for ${on} ${ctx.tableName}.${ctx.fieldName}`,
                operationClass,
                target: { id: 'postgres' },
                precheck: [],
                execute: [],
                postcheck: [],
              }),
            },
          ]
        : [],
  };
  return [
    ...components,
    {
      kind: 'adapter',
      id: 'field-event-hook',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.0',
      types: { codecTypes: { controlPlaneHooks: { 'pg/text@1': hooks } } },
    } as (typeof components)[number],
  ];
}

describe('Postgres planner under db update', () => {
  const DB_UPDATE = { allowedOperationClasses: ['additive', 'widening', 'destructive'] as const };

  async function dbUpdatePlan(
    from: Contract<SqlStorage>,
    to: Contract<SqlStorage>,
    fromContract: Contract<SqlStorage> | null,
  ) {
    const result = createPostgresMigrationPlanner(stubLowerer).plan({
      contract: to,
      schema: postgresContractToSchema(from, postgresTypeComponents),
      policy: DB_UPDATE,
      fromContract,
      origin: null,
      statements: [],
      frameworkComponents: withFieldHook(postgresTypeComponents, 'added', 'additive'),
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
    const operations = (await Promise.all(result.plan.operations)).map(
      ({ id, label, operationClass }) => ({ id, label, operationClass }),
    );
    return { origin: result.plan.origin, operations };
  }

  it('plans the same operations with and without the origin contract, codec field-event hooks included, and asserts no origin', async () => {
    const from = contract('from', {
      Legacy: { columns: { id: 'int4' } },
      User: {
        columns: { id: 'int4', nickname: 'text', age: 'text', score: 'int4', email: 'text?' },
      },
    });
    const to = contract('to', {
      User: { columns: { id: 'int4', age: 'int4', score: 'int8', email: 'text', bio: 'text?' } },
    });

    const withOrigin = await dbUpdatePlan(from, to, from);
    const without = await dbUpdatePlan(from, to, null);

    expect(withOrigin).toEqual(without);
    expect(withOrigin.origin).toBeNull();
    expect(withOrigin.operations.length).toBeGreaterThan(0);
  });
});
