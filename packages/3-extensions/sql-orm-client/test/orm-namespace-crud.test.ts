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
  const cols: Record<string, { codecId: string; nativeType: string; nullable: boolean }> = {};
  for (const column of columns) {
    cols[column] = { codecId: 'pg/text@1', nativeType: 'text', nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Same bare model name (`User`) in two namespaces, distinct field maps and
// distinct tables, so CRUD execution must resolve metadata within the
// collection's namespace rather than the default/first-match.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {},
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

type CrudCollection = {
  all(): { toArray(): Promise<Record<string, unknown>[]> };
  select(...fields: string[]): CrudCollection;
  where(filter: Record<string, unknown>): CrudCollection;
  createAndCount(rows: readonly Record<string, unknown>[]): Promise<number>;
  updateAndCount(values: Record<string, unknown>): Promise<number>;
  deleteAndCount(): Promise<number>;
};
type TwoNamespaceOrm = { public: { User: CrudCollection }; auth: { User: CrudCollection } };

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

describe('namespaced orm CRUD execution', () => {
  it('selects per-namespace, mapping returned rows with the namespace column map', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, email_addr: 'a@example.com' }]]);
    const publicRows = await db.public.User.all().toArray();
    expect(publicRows).toEqual([{ id: 1, email: 'a@example.com' }]);
    expect(lastPlanTable(runtime).name).toBe('users');
    expect(lastPlanTable(runtime).namespaceId).toBe('public');

    runtime.setNextResults([[{ id: 2, token_col: 'tok' }]]);
    const authRows = await db.auth.User.all().toArray();
    expect(authRows).toEqual([{ id: 2, token: 'tok' }]);
    expect(lastPlanTable(runtime).name).toBe('auth_users');
    expect(lastPlanTable(runtime).namespaceId).toBe('auth');
  });

  it('binds a shorthand where within the namespace', async () => {
    const { db, runtime } = setup();
    runtime.setNextResults([[]]);
    await db.auth.User.where({ token: 'tok' }).all().toArray();
    expect(lastPlanTable(runtime).name).toBe('auth_users');
  });

  it('inserts within the namespace target table', async () => {
    const { db, runtime } = setup();
    runtime.setNextStats([{ affectedRows: 1 }, { affectedRows: 1 }]);
    expect(await db.public.User.createAndCount([{ email: 'a@example.com' }])).toBe(1);
    expect(lastPlanTable(runtime).namespaceId).toBe('public');
    expect(lastPlanTable(runtime).name).toBe('users');

    expect(await db.auth.User.createAndCount([{ token: 'tok' }])).toBe(1);
    expect(lastPlanTable(runtime).name).toBe('auth_users');
  });

  it('updates within the namespace target table', async () => {
    const { db, runtime } = setup();
    runtime.setNextStats([{ affectedRows: 1 }]);
    await db.auth.User.where({ token: 'tok' }).updateAndCount({ token: 'new' });
    expect(lastPlanTable(runtime).name).toBe('auth_users');
  });

  it('deletes within the namespace target table', async () => {
    const { db, runtime } = setup();
    runtime.setNextStats([{ affectedRows: 1 }]);
    await db.public.User.where({ email: 'a@example.com' }).deleteAndCount();
    expect(lastPlanTable(runtime).name).toBe('users');
  });
});
