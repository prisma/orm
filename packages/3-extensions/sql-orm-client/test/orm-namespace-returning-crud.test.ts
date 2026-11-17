import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { TableSource } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { createMockRuntime, getEmptyAggregates, type MockRuntime } from './helpers';

function model(table: string, fieldColumns: Record<string, string>) {
  const fields: Record<string, { type: { kind: string; codecId: string } }> = {};
  const storageFields: Record<string, { column: string }> = {};
  for (const [field, column] of Object.entries(fieldColumns)) {
    fields[field] = { type: { kind: 'scalar', codecId: 'pg/text@1' } };
    storageFields[field] = { column };
  }
  return { fields, relations: {}, storage: { table, fields: storageFields } };
}

function storageTable(columns: string[]) {
  const cols: Record<string, { codecId: string; dataType: string; nullable: boolean }> = {};
  for (const column of columns) {
    cols[column] = { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Same bare model name (`User`) in two namespaces, no relations, distinct field
// maps and tables, so returning-row mutation execution must resolve metadata
// within the collection's namespace rather than the default/first-match.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: { returning: { enabled: true } },
  domain: {
    namespaces: {
      public: { models: { User: model('users', { id: 'id', email: 'email_addr' }) } },
      auth: { models: { User: model('auth_users', { id: 'id', token: 'token_col' }) } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: { id: 'public', entries: { table: { users: storageTable(['id', 'email_addr']) } } },
      auth: { id: 'auth', entries: { table: { auth_users: storageTable(['id', 'token_col']) } } },
    },
  },
});

type ReturningCollection = {
  create(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  where(filter: Record<string, unknown>): ReturningCollection;
  deleteAll(): { toArray(): Promise<Record<string, unknown>[]> };
};
type TwoNamespaceOrm = {
  public: { User: ReturningCollection };
  auth: { User: ReturningCollection };
};

function setup(): { db: TwoNamespaceOrm; runtime: MockRuntime } {
  const runtime = createMockRuntime();
  const db = blindCast<TwoNamespaceOrm, 'loose runtime view of the namespaced orm client'>(
    orm({
      runtime,
      context: blindCast<ExecutionContext<Contract<SqlStorage>>, 'stub execution context'>({
        contract: twoNamespaceContract,
        applyMutationDefaults: () => [],
        codecDescriptors: { descriptorFor: () => ({ traits: ['equality'] }) },
        aggregateDescriptors: getEmptyAggregates(),
      }),
    }),
  );
  return { db, runtime };
}

function lastPlanTable(runtime: MockRuntime): TableSource {
  const plan = runtime.executions[runtime.executions.length - 1]?.plan;
  const ast = blindCast<
    { from?: TableSource; table?: TableSource },
    'plan ast carries a table source'
  >((plan as { ast: unknown }).ast);
  const source = ast.from ?? ast.table;
  if (!source) throw new Error('plan ast had neither from nor table');
  return source;
}

describe('namespaced orm returning-row mutation execution', () => {
  it('create returns the inserted row mapped within the namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicRow = await db.public.User.create({ email: 'a@example.com' });
    expect(publicRow).toEqual({ id: 1, email: 'a@example.com' });
    expect(lastPlanTable(runtime).name).toBe('users');
    expect(lastPlanTable(runtime).namespaceId).toBe('public');

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authRow = await db.auth.User.create({ token: 'tok' });
    expect(authRow).toEqual({ id: 2, token: 'tok' });
    expect(lastPlanTable(runtime).name).toBe('auth_users');
    expect(lastPlanTable(runtime).namespaceId).toBe('auth');
  });

  it('deleteAll returns the deleted rows mapped within the namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicDeleted = await db.public.User.where({ email: 'a@example.com' })
      .deleteAll()
      .toArray();
    expect(publicDeleted).toEqual([{ id: 1, email: 'a@example.com' }]);
    expect(lastPlanTable(runtime).name).toBe('users');

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authDeleted = await db.auth.User.where({ token: 'tok' }).deleteAll().toArray();
    expect(authDeleted).toEqual([{ id: 2, token: 'tok' }]);
    expect(lastPlanTable(runtime).name).toBe('auth_users');
  });
});
