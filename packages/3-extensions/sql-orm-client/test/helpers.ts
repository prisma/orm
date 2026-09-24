import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import {
  type ColumnDefaultLiteralInputValue,
  domainModelsAtDefaultNamespace,
  type Contract as FrameworkContract,
} from '@internal/contract/types';
import type {
  CodecDescriptor,
  CodecInstanceContext,
  ColumnTypeDescriptor,
} from '@internal/framework-components/codec';
import { dataTypeId } from '@internal/framework-components/codec';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Codec, SelectAst, SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type RuntimeMutationDefaultGenerator,
  type RuntimeParameterizedCodecDescriptor,
  type SqlRuntimeExtensionDescriptor,
} from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import type { RuntimeQueryable } from '../src/types';
import { defineContract, field, model, rel, type ScalarFieldBuilder } from './contract-builder';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };
import { defineTestCodec } from './test-codec';

export function isSelectAst(ast: unknown): ast is SelectAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'select';
}

const postgresContractSerializer = new PostgresContractSerializer();

export function deserializeTestContract(json: unknown = contractJson): Contract {
  return postgresContractSerializer.deserializeContract(json) as Contract;
}

const baseTestContract = deserializeTestContract();

export type TestContract = Contract;

export function getTestContract(): TestContract {
  return deserializeTestContract(JSON.parse(JSON.stringify(contractJson)));
}

/**
 * Override the capabilities of a {@link TestContract} for a test scenario.
 *
 * The narrow `TestContract` type fixes `capabilities` to the literal shape
 * generated for `fixtures/generated/contract.json`. Tests need contracts
 * with arbitrary capability shapes — empty, only-jsonAgg, cross-namespace,
 * etc. — and want the override's literal types preserved so capability-
 * dependent type checks remain meaningful.
 *
 * The result widens `TestContract`'s `capabilities` slot to the caller's
 * `TCaps`, which the framework `Contract` interface already permits
 * (`capabilities: Record<string, Record<string, boolean>>`).
 */
export function withCapabilities<TCaps extends Record<string, Record<string, boolean>>>(
  contract: TestContract,
  capabilities: TCaps,
): Omit<TestContract, 'capabilities'> & { readonly capabilities: TCaps } {
  return { ...contract, capabilities };
}

export function withPatchedDomainModels<T extends FrameworkContract<SqlStorage>>(
  contract: T,
  patch: (models: Record<string, unknown>) => Record<string, unknown>,
): T {
  const [namespaceId, namespace] = Object.entries(contract.domain.namespaces)[0]!;
  const models = domainModelsAtDefaultNamespace(contract.domain);
  return {
    ...contract,
    domain: {
      namespaces: {
        ...contract.domain.namespaces,
        [namespaceId]: {
          ...namespace,
          models: patch({ ...models }) as typeof namespace.models,
        },
      },
    },
  } as T;
}

type MutableDomainModels = Record<
  string,
  {
    fields: Record<string, unknown>;
    relations: Record<string, unknown>;
    storage: Record<string, unknown>;
    discriminator?: { field: string };
    variants?: Record<string, { value: string }>;
    base?: { model: string; namespace: string };
  }
>;

function unboundDomainModels(raw: {
  domain: { namespaces: Record<string, { models: MutableDomainModels }> };
}): MutableDomainModels {
  const ns = Object.values(raw.domain.namespaces)[0];
  if (!ns) throw new Error('no domain namespace found');
  return ns.models;
}

const pgVectorCodecStubExtension: SqlRuntimeExtensionDescriptor<'postgres'> = (() => {
  const factory: (params: { length: number }) => (ctx: CodecInstanceContext) => Codec = () => () =>
    defineTestCodec({
      typeId: 'pg/vector@1',
      encode: (value: number[]) => value,
      decode: (wire: number[]) => wire,
    });

  const vectorDescriptor: RuntimeParameterizedCodecDescriptor<{ length: number }> = {
    codecId: 'pg/vector@1',
    dataType: dataTypeId('pg/vector'),
    traits: ['equality'],
    targetTypes: ['vector'],
    paramsSchema: {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: value as { length: number } }),
      },
    },
    isParameterized: true,
    factory,
  };

  const descriptors: ReadonlyArray<CodecDescriptor> = [
    vectorDescriptor as unknown as CodecDescriptor,
  ];

  return {
    kind: 'extension' as const,
    id: 'pgvector',
    version: '0.0.0',
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
    codecs: () => descriptors,
    create() {
      return { familyId: 'sql' as const, targetId: 'postgres' as const };
    },
  };
})();

/**
 * Builds an {@link ExecutionContext} from the given contract — unlike
 * spreading `{ ...getTestContext(), contract }`, this makes
 * `applyMutationDefaults` observe the patched contract's execution defaults
 * (the context's defaults applier is a closure over the contract it was
 * created from). Extra mutation default generators referenced by the
 * contract can be registered via `options.mutationDefaultGenerators`.
 */
export function buildTestContextFromContract<TContract extends FrameworkContract<SqlStorage>>(
  contract: TContract,
  options?: {
    readonly mutationDefaultGenerators?: ReadonlyArray<RuntimeMutationDefaultGenerator>;
  },
): ExecutionContext<TContract> {
  const generators = options?.mutationDefaultGenerators ?? [];
  const extensions: SqlRuntimeExtensionDescriptor<'postgres'>[] = [pgVectorCodecStubExtension];
  if (generators.length > 0) {
    extensions.push({
      kind: 'extension',
      id: 'test-mutation-default-generators',
      version: '0.0.0',
      familyId: 'sql',
      targetId: 'postgres',
      codecs: () => [],
      mutationDefaultGenerators: () => generators,
      create() {
        return { familyId: 'sql' as const, targetId: 'postgres' as const };
      },
    });
  }

  return createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      extensions,
    }),
  });
}

const testContext: ExecutionContext<TestContract> = buildTestContextFromContract(baseTestContract);

export function getTestContext(): ExecutionContext<TestContract> {
  return testContext;
}

/**
 * The aggregate registry the composed PostgreSQL stack contributes — what plan
 * builders resolve result codecs against, so a plan test measures the real
 * matrix rather than a stub of it.
 */
export function getTestAggregates(): ExecutionContext<TestContract>['aggregateDescriptors'] {
  return testContext.aggregateDescriptors;
}

/**
 * A registry that contributes nothing, for the stub contexts whose cases never
 * reach an aggregate. Those contexts still need one: the derived surface
 * enumerates the registry at collection construction and at ORM composition.
 * Typed here rather than at each call site, where the surrounding
 * `blindCast` would hide a drift from the registry interface.
 */
export function getEmptyAggregates(): ExecutionContext<TestContract>['aggregateDescriptors'] {
  return { resolve: () => undefined, values: function* () {} };
}

export interface MockExecution {
  readonly operation: 'query' | 'execute';
  readonly plan: SqlExecutionPlan | SqlQueryPlan<unknown>;
  readonly rows: Record<string, unknown>[];
  readonly stats?: SqlStatementStats;
}

export interface MockRuntime extends RuntimeQueryable {
  readonly executions: MockExecution[];
  setNextResults(results: Record<string, unknown>[][]): void;
  setNextStats(stats: readonly SqlStatementStats[]): void;
}

/**
 * Builds a contract with a mixed-polymorphism Task hierarchy:
 * - Task (base, table: tasks, discriminator: type)
 * - Bug (STI, table: tasks, value: bug) with `severity` field and an
 *   `assignee` relation (assignee_id → assignees.id, on the base table)
 * - Feature (MTI, table: features, value: feature) with `priority` field and
 *   an `assignee` relation (assignee_id → assignees.id, on the variant table)
 *
 * A non-polymorphic `Project` parent (table: projects_tbl) owns a `tasks`
 * relation targeting the polymorphic `Task`, so an include can be planned
 * against a polymorphic target. `Task` also carries a self-relation
 * `subtasks` (parent_id → id) so the self-relation alias path can be
 * exercised on a polymorphic target.
 */
export function buildMixedPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));

  const domainModels = unboundDomainModels(raw);
  domainModels['Task'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      projectId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      parentId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {
      subtasks: {
        to: { model: 'Task', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['parentId'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'tasks',
      fields: {
        id: { column: 'id' },
        title: { column: 'title' },
        type: { column: 'type' },
        projectId: { column: 'project_id' },
        parentId: { column: 'parent_id' },
      },
    },
    discriminator: { field: 'type' },
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
  };

  domainModels['Project'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      tasks: {
        to: { model: 'Task', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['projectId'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'projects_tbl',
      fields: { id: { column: 'id' }, name: { column: 'name' } },
    },
  };

  domainModels['Bug'] = {
    fields: {
      severity: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      assigneeId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {
      assignee: {
        to: { model: 'Assignee', namespace: 'public' },
        cardinality: 'N:1',
        nullable: true,
        on: { localFields: ['assigneeId'], targetFields: ['id'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'tasks',
      fields: { severity: { column: 'severity' }, assigneeId: { column: 'assignee_id' } },
    },
    base: { model: 'Task', namespace: 'public' },
  };

  domainModels['Feature'] = {
    fields: {
      priority: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      assigneeId: { nullable: true, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {
      assignee: {
        to: { model: 'Assignee', namespace: 'public' },
        cardinality: 'N:1',
        nullable: true,
        on: { localFields: ['assigneeId'], targetFields: ['id'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'features',
      fields: { priority: { column: 'priority' }, assigneeId: { column: 'assignee_id' } },
    },
    base: { model: 'Task', namespace: 'public' },
  };

  domainModels['Assignee'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      namespaceId: 'public',
      table: 'assignees',
      fields: { id: { column: 'id' }, name: { column: 'name' } },
    },
  };

  raw.storage.namespaces.public.entries.table.tasks = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      type: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      severity: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
      project_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
      parent_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
      assignee_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces.public.entries.table.projects_tbl = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces.public.entries.table.features = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      priority: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      assignee_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces.public.entries.table.assignees = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return deserializeTestContract(raw);
}

/**
 * Builds a contract with an STI-only User hierarchy:
 * - User (base, table: users, discriminator: kind)
 * - Admin (STI, table: users, value: admin) with `role` field
 * - Regular (STI, table: users, value: regular) with `plan` field
 *
 * A non-polymorphic `Account` parent (table: accounts) owns a `members`
 * relation targeting the STI-polymorphic `User`, so an include can be
 * planned against an STI-only polymorphic target (no MTI variant tables,
 * so no joins — only discriminator + variant base-table column projection).
 */
export function buildStiPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));
  const domainModels = unboundDomainModels(raw);

  const userModel = domainModels['User']!;
  userModel.fields['kind'] = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/text@1' },
  };
  (userModel.storage as { fields: Record<string, { column: string }> }).fields['kind'] = {
    column: 'kind',
  };
  userModel.fields['accountId'] = {
    nullable: true,
    type: { kind: 'scalar', codecId: 'pg/int4@1' },
  };
  (userModel.storage as { fields: Record<string, { column: string }> }).fields['accountId'] = {
    column: 'account_id',
  };
  userModel.discriminator = { field: 'kind' };
  userModel.variants = {
    Admin: { value: 'admin' },
    Regular: { value: 'regular' },
  };

  domainModels['Account'] = {
    fields: {
      id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {
      members: {
        to: { model: 'User', namespace: 'public' },
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['accountId'] },
      },
    },
    storage: {
      namespaceId: 'public',
      table: 'accounts',
      fields: { id: { column: 'id' }, name: { column: 'name' } },
    },
  };

  domainModels['Admin'] = {
    fields: { role: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { namespaceId: 'public', table: 'users', fields: { role: { column: 'role' } } },
    base: { model: 'User', namespace: 'public' },
  };

  domainModels['Regular'] = {
    fields: { plan: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
    relations: {},
    storage: { namespaceId: 'public', table: 'users', fields: { plan: { column: 'plan' } } },
    base: { model: 'User', namespace: 'public' },
  };

  const usersStorageTable = Object.values(
    raw.storage.namespaces as Record<
      string,
      { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
    >,
  ).find((ns) => ns.entries.table['users'])?.entries.table['users'];
  if (!usersStorageTable) throw new Error('users table not found in any storage namespace');
  usersStorageTable.columns['kind'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: false,
  };
  usersStorageTable.columns['role'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  usersStorageTable.columns['plan'] = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  usersStorageTable.columns['account_id'] = {
    codecId: 'pg/int4@1',
    nativeType: 'int4',
    nullable: true,
  };

  raw.storage.namespaces.public.entries.table.accounts = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  return deserializeTestContract(raw);
}

type RawColumn = {
  nativeType: string;
  codecId: string;
  nullable: boolean;
  // A string default is treated as a SQL expression (`defaultSql`); any other
  // literal is a value default (`default`).
  default?: string | ColumnDefaultLiteralInputValue;
};

// extraColumns carry a raw codecId/nativeType pair; a ColumnTypeDescriptor is
// exactly that pair, so the DSL accepts it directly without any contract-shaped
// literal.
function extraColumnDescriptor(col: RawColumn): ColumnTypeDescriptor {
  return { codecId: col.codecId, nativeType: col.nativeType };
}

/**
 * Builds a minimal M:N contract with Parent <-> Child via a junction table,
 * authored through the contract-builder DSL. Used by unit tests that assert
 * M:N include and nested-write behavior.
 */
export function buildManyToManyContract(opts: {
  junctionTable: string;
  parentColumns: string[];
  childColumns: string[];
  targetColumns: string[];
  localFields?: string[];
  extraColumns?: Record<string, RawColumn>;
}) {
  const {
    junctionTable,
    parentColumns,
    childColumns,
    targetColumns,
    localFields = ['id'],
    extraColumns = {},
  } = opts;

  // Field names match the storage column names throughout (the relation
  // criteria and mutation payloads in the suite address columns by these
  // names), so each `field.column(...)` keeps the default column = field name.
  const parentFields: Record<string, ScalarFieldBuilder> = {};
  for (const col of localFields) {
    parentFields[col] = field.column(int4Column);
  }
  const Parent = model('Parent', { fields: parentFields }).attributes(
    ({ fields, constraints }) => ({
      id: constraints.id(localFields.map((col) => fields[col]!)),
    }),
  );

  const childFields: Record<string, ScalarFieldBuilder> = {};
  for (const col of targetColumns) {
    childFields[col] = field.column(int4Column);
  }
  const Child = model('Child', { fields: childFields })
    .attributes(({ fields, constraints }) => ({
      id: constraints.id(targetColumns.map((col) => fields[col]!)),
    }))
    .sql({ table: 'children' });

  // A column shared by parentColumns and childColumns (e.g. a `tenant_id`
  // discriminator) is a single physical junction column, so dedupe before
  // declaring the fields and the composite primary key.
  const junctionPkColumns = [...new Set([...parentColumns, ...childColumns])];
  const junctionFields: Record<string, ScalarFieldBuilder> = {};
  for (const col of junctionPkColumns) {
    junctionFields[col] = field.column(int4Column);
  }
  for (const [name, col] of Object.entries(extraColumns)) {
    let builder: ScalarFieldBuilder = field.column(extraColumnDescriptor(col));
    if (col.nullable) {
      builder = builder.optional();
    }
    if (col.default !== undefined) {
      builder =
        typeof col.default === 'string'
          ? builder.default({ kind: 'function', expression: col.default })
          : builder.default(col.default);
    }
    junctionFields[name] = builder;
  }
  const Junction = model('Junction', { fields: junctionFields })
    .attributes(({ fields, constraints }) => ({
      id: constraints.id(junctionPkColumns.map((col) => fields[col]!)),
    }))
    .sql({ table: junctionTable });

  const ParentWithRelation = Parent.relations({
    children: rel.manyToMany(() => Child, {
      through: () => Junction,
      from: parentColumns,
      to: childColumns,
    }),
  }).sql({ table: 'parents' });

  return defineContract({
    models: { Parent: ParentWithRelation, Child, Junction },
  });
}

/**
 * Extends {@link buildManyToManyContract} with an `Owner` model and an N:1
 * `owner` relation on `Child` (children.owner_id → owners.id), so tests can
 * exercise junction-created targets that carry their own relation mutations.
 */
export function buildManyToManyContractWithTargetRelation() {
  const Parent = model('Parent', {
    fields: { id: field.column(int4Column).id() },
  });

  const Owner = model('Owner', {
    fields: { id: field.column(int4Column).id() },
  }).sql({ table: 'owners' });

  const Child = model('Child', {
    fields: {
      id: field.column(int4Column).id(),
      ownerId: field.column(int4Column).column('owner_id'),
    },
    relations: {
      owner: rel.belongsTo(Owner, { from: 'ownerId', to: 'id' }),
    },
  }).sql({ table: 'children' });

  const Junction = model('Junction', {
    fields: {
      parentId: field.column(int4Column).column('parent_id'),
      childId: field.column(int4Column).column('child_id'),
    },
  })
    .attributes(({ fields, constraints }) => ({
      id: constraints.id([fields.parentId, fields.childId]),
    }))
    .sql({ table: 'parent_child' });

  const ParentWithRelation = Parent.relations({
    children: rel.manyToMany(() => Child, {
      through: () => Junction,
      from: 'parentId',
      to: 'childId',
    }),
  }).sql({ table: 'parents' });

  return defineContract({
    models: { Parent: ParentWithRelation, Owner, Child, Junction },
  });
}

/**
 * Builds a User <-> Role M:N contract whose `user_roles` junction carries a
 * NOT NULL `level` payload column whose only default is an execution-time
 * onCreate generator (`test-level`) — no storage default. Authored through the
 * DSL: `field.generated` stamps the execution onCreate default and leaves the
 * column NOT NULL with no storage default, so the connect/create gate stays
 * open and `insertJunctionLink` must populate `level` before the INSERT.
 */
export function buildExecutionDefaultJunctionContract() {
  const User = model('User', {
    fields: {
      id: field.column(int4Column).id(),
      name: field.column(textColumn),
      email: field.column(textColumn).unique(),
    },
  });

  const Role = model('Role', {
    fields: {
      id: field.column(textColumn).id(),
      name: field.column(textColumn).unique(),
    },
  }).sql({ table: 'roles' });

  const UserRole = model('UserRole', {
    fields: {
      userId: field.column(int4Column).column('user_id'),
      roleId: field.column(textColumn).column('role_id'),
      level: field.generated({
        type: int4Column,
        generated: { kind: 'generator', id: 'test-level' },
      }),
    },
  })
    .attributes(({ fields, constraints }) => ({
      id: constraints.id([fields.userId, fields.roleId]),
    }))
    .sql({ table: 'user_roles' });

  const UserWithRelation = User.relations({
    roles: rel.manyToMany(() => Role, {
      through: () => UserRole,
      from: 'userId',
      to: 'roleId',
    }),
  }).sql({ table: 'users' });

  return defineContract({
    models: { User: UserWithRelation, Role, UserRole },
  });
}

/**
 * Builds a contract whose `User` model (table `users`) keys on a custom
 * primary-key column `pk_id` instead of the conventional `id`. Authored
 * through the contract-builder DSL so `buildPrimaryKeyFilterFromRow` reads a
 * real emitted primary key rather than a hand-patched storage table.
 */
export function buildCustomPrimaryKeyContract() {
  const User = model('User', {
    fields: {
      pk_id: field.column(int4Column).id(),
      name: field.column(textColumn),
    },
  }).sql({ table: 'users' });

  return defineContract({ models: { User } });
}

export function createMockRuntime(): MockRuntime {
  const executions: MockExecution[] = [];
  let nextResults: Record<string, unknown>[][] = [];
  let nextStats: SqlStatementStats[] = [];

  const runtime: MockRuntime = {
    executions,
    setNextResults(results: Record<string, unknown>[][]) {
      nextResults = [...results];
    },
    setNextStats(stats: readonly SqlStatementStats[]) {
      nextStats = [...stats];
    },
    query<Row>(
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    ): AsyncIterableResult<Row> {
      const rows = (nextResults.shift() ?? []) as Row[];
      executions.push({
        operation: 'query',
        plan,
        rows: rows as Record<string, unknown>[],
      });
      const gen = async function* (): AsyncGenerator<Row, void, unknown> {
        for (const row of rows) {
          yield row;
        }
      };
      return new AsyncIterableResult(gen());
    },
    async execute(plan: SqlExecutionPlan | SqlQueryPlan): Promise<SqlStatementStats> {
      const stats = nextStats.shift() ?? { affectedRows: 0 };
      executions.push({ operation: 'execute', plan, rows: [], stats });
      return stats;
    },
  };

  return runtime;
}
