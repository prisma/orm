import postgresAdapter from '@internal/adapter-postgres/runtime';
import {
  domainModelsAtDefaultNamespace,
  type Contract as FrameworkContract,
} from '@internal/contract/types';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';

const POSTGRES_DEFAULT_NAMESPACE_ID = 'public' as const;

import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RuntimeQueryable } from '@internal/sql-orm-client';
import type { SelectAst, SqlStatementStats } from '@internal/sql-relational-core/ast';
import type { SqlExecutionPlan, SqlQueryPlan } from '@internal/sql-relational-core/plan';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import type { Contract as ExecutionDefaultedTagsContract } from './fixtures/execution-defaulted-tags/generated/contract';
import executionDefaultedTagsContractJson from './fixtures/execution-defaulted-tags/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};

export function isSelectAst(ast: unknown): ast is SelectAst {
  return typeof ast === 'object' && ast !== null && 'kind' in ast && ast.kind === 'select';
}

const postgresContractSerializer = new PostgresContractSerializer();

export function deserializeTestContract(json: unknown = contractJson): TestContract {
  return postgresContractSerializer.deserializeContract(json) as TestContract;
}

const baseTestContract = deserializeTestContract();

export type TestContract = Contract;

export function getTestContract(): TestContract {
  // Re-deserialize so storage namespaces keep PostgresSchema.qualifyTable (structuredClone strips methods).
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
  const namespaceId = POSTGRES_DEFAULT_NAMESPACE_ID;
  const namespace = contract.domain.namespaces[namespaceId]!;
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

type MutableDomainModel = {
  fields: Record<string, unknown>;
  relations: Record<string, unknown>;
  storage: Record<string, unknown>;
  discriminator?: { field: string };
  variants?: Record<string, { value: string }>;
  base?: { model: string; namespace: string };
};

function unboundDomainModels(raw: {
  domain: { namespaces: Record<string, { models: Record<string, unknown> }> };
}): Record<string, MutableDomainModel> {
  return raw.domain.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID]!.models as Record<
    string,
    MutableDomainModel
  >;
}

const testContext: ExecutionContext<TestContract> = createExecutionContext({
  contract: baseTestContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [pgvectorRuntime],
  }),
});

export function getTestContext(): ExecutionContext<TestContract> {
  return testContext;
}

export type { PolyContract };

export function deserializePolyContract(json: unknown = polyContractJson): PolyContract {
  return postgresContractSerializer.deserializeContract(json) as PolyContract;
}

export type { ExecutionDefaultedTagsContract };

// The emitted contract whose `user_tags.created_at` junction payload column
// carries an execution-time onCreate default (no storage default). Re-deserialize
// per call so storage namespaces keep their methods (structuredClone strips them).
export function getExecutionDefaultedTagsContract(): ExecutionDefaultedTagsContract {
  return postgresContractSerializer.deserializeContract(
    JSON.parse(JSON.stringify(executionDefaultedTagsContractJson)),
  ) as ExecutionDefaultedTagsContract;
}

const polyTestContract = deserializePolyContract();

const polyTestContext: ExecutionContext<PolyContract> = createExecutionContext({
  contract: polyTestContract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [pgvectorRuntime],
  }),
});

export function getPolyTestContext(): ExecutionContext<PolyContract> {
  return polyTestContext;
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
 * - Bug (STI, table: tasks, value: bug) with `severity` field
 * - Feature (MTI, table: features, value: feature) with `priority` field
 */
export function buildMixedPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));

  const domainModels = unboundDomainModels(raw);
  domainModels['Task'] = {
    fields: {
      id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
      title: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      type: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      namespaceId: POSTGRES_DEFAULT_NAMESPACE_ID,
      table: 'tasks',
      fields: { id: { column: 'id' }, title: { column: 'title' }, type: { column: 'type' } },
    },
    discriminator: { field: 'type' },
    variants: { Bug: { value: 'bug' }, Feature: { value: 'feature' } },
  };

  domainModels['Bug'] = {
    fields: {
      severity: { nullable: true, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      namespaceId: POSTGRES_DEFAULT_NAMESPACE_ID,
      table: 'tasks',
      fields: { severity: { column: 'severity' } },
    },
    base: { model: 'Task', namespace: POSTGRES_DEFAULT_NAMESPACE_ID },
  };

  domainModels['Feature'] = {
    fields: {
      priority: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
    },
    relations: {},
    storage: {
      namespaceId: POSTGRES_DEFAULT_NAMESPACE_ID,
      table: 'features',
      fields: { priority: { column: 'priority' } },
    },
    base: { model: 'Task', namespace: POSTGRES_DEFAULT_NAMESPACE_ID },
  };

  raw.storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID].entries.table.tasks = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      type: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      severity: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };

  raw.storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID].entries.table.features = {
    columns: {
      id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
      priority: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
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
 */
export function buildStiPolyContract(): TestContract {
  const raw = JSON.parse(JSON.stringify(getTestContract()));
  const domainModels = unboundDomainModels(raw);

  const userModel = domainModels['User']!;
  userModel.fields['kind'] = {
    nullable: false,
    many: false,
    type: { kind: 'scalar', codecId: 'pg/text@1' },
  };
  (userModel.storage as { fields: Record<string, { column: string }> }).fields['kind'] = {
    column: 'kind',
  };
  userModel.discriminator = { field: 'kind' };
  userModel.variants = {
    Admin: { value: 'admin' },
    Regular: { value: 'regular' },
  };

  domainModels['Admin'] = {
    fields: {
      role: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      namespaceId: POSTGRES_DEFAULT_NAMESPACE_ID,
      table: 'users',
      fields: { role: { column: 'role' } },
    },
    base: { model: 'User', namespace: POSTGRES_DEFAULT_NAMESPACE_ID },
  };

  domainModels['Regular'] = {
    fields: {
      plan: { nullable: true, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
    },
    relations: {},
    storage: {
      namespaceId: POSTGRES_DEFAULT_NAMESPACE_ID,
      table: 'users',
      fields: { plan: { column: 'plan' } },
    },
    base: { model: 'User', namespace: POSTGRES_DEFAULT_NAMESPACE_ID },
  };

  raw.storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID].entries.table.users.columns.kind = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: false,
  };
  raw.storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID].entries.table.users.columns.role = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };
  raw.storage.namespaces[POSTGRES_DEFAULT_NAMESPACE_ID].entries.table.users.columns.plan = {
    codecId: 'pg/text@1',
    nativeType: 'text',
    nullable: true,
  };

  return deserializeTestContract(raw);
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
