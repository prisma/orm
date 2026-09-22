import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { TableSource } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import { buildTestContextFromContract, createMockRuntime, type MockRuntime } from './helpers';

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

// `User` is declared in BOTH namespaces (same bare model name), so resolving the
// `public.Profile.user -> auth.User` relation target without its namespace would
// first-match `public.User`. The base model `Profile` declares the cross-namespace
// relation, exercising relation-target resolution on a multi-namespace contract.
const profileModel = {
  fields: {
    id: { type: { kind: 'scalar', codecId: 'pg/text@1' } },
    bio: { type: { kind: 'scalar', codecId: 'pg/text@1' } },
    userId: { type: { kind: 'scalar', codecId: 'pg/text@1' } },
  },
  relations: {
    user: {
      to: { model: 'User', namespace: 'auth' },
      cardinality: 'N:1',
      nullable: false,
      on: { localFields: ['userId'], targetFields: ['id'] },
    },
  },
  storage: {
    table: 'profiles',
    fields: { id: { column: 'id' }, bio: { column: 'bio_col' }, userId: { column: 'user_id' } },
  },
};

const publicUserModel = {
  fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' } } },
  relations: {},
  storage: { table: 'users', fields: { id: { column: 'id' }, email: { column: 'email_addr' } } },
};

const authUserModel = {
  fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' } } },
  relations: {},
  storage: {
    table: 'auth_users',
    fields: { id: { column: 'id' }, token: { column: 'token_col' } },
  },
};

const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: {
    returning: { enabled: true },
    sql: { jsonAgg: true, returning: true, lateral: true },
    postgres: { jsonAgg: true, returning: true, lateral: true },
  },
  domain: {
    namespaces: {
      public: { models: { Profile: profileModel, User: publicUserModel } },
      auth: { models: { User: authUserModel } },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: {
          table: {
            profiles: storageTable(['id', 'bio_col', 'user_id']),
            users: storageTable(['id', 'email_addr']),
          },
        },
      },
      auth: { id: 'auth', entries: { table: { auth_users: storageTable(['id', 'token_col']) } } },
    },
  },
});
const twoNamespaceContext = buildTestContextFromContract(twoNamespaceContract);

type RelationCollection = {
  create(values: Record<string, unknown>): Promise<Record<string, unknown>>;
  include(relationName: string): { first(): Promise<Record<string, unknown> | null> };
};
type TwoNamespaceOrm = { public: { Profile: RelationCollection } };

function setup(): { db: TwoNamespaceOrm; runtime: MockRuntime } {
  const runtime = createMockRuntime();
  const db = blindCast<TwoNamespaceOrm, 'loose runtime view of the namespaced orm client'>(
    orm({
      runtime,
      context: twoNamespaceContext,
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

describe('namespaced orm cross-namespace relation', () => {
  it('executes base CRUD on a model that declares a cross-namespace relation', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([[{ id: 1, bio_col: 'hi', user_id: 9 }]]);
    const created = await db.public.Profile.create({ bio: 'hi', userId: 9 });
    expect(created).toEqual({ id: 1, bio: 'hi', userId: 9 });
    expect(lastPlanTable(runtime).name).toBe('profiles');
    expect(lastPlanTable(runtime).namespaceId).toBe('public');
  });

  it('resolves a cross-namespace include within the target namespace', async () => {
    const { db, runtime } = setup();

    runtime.setNextResults([
      [{ id: 1, bio_col: 'hi', user_id: 9, user: '[{"id":9,"token_col":"tok"}]' }],
    ]);
    const profile = await db.public.Profile.include('user').first();
    expect(profile).toEqual({
      id: 1,
      bio: 'hi',
      userId: 9,
      user: { id: 9, token: 'tok' },
    });
  });
});
