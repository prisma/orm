import type { TableSource } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import type { Contract } from '../fixtures/generated/contract';

/** No target contributes aggregates to these plan-shape cases; resolution answers nothing and the codec slot stays empty. */
const emptyAggregateRegistry = {
  resolve: () => undefined,
  values: function* () {},
};

const int4 = { many: false, codecId: 'pg/int4@1', nativeType: 'int4', nullable: false } as const;
const text = { many: false, codecId: 'pg/text@1', nativeType: 'text', nullable: false } as const;

function table(columns: Record<string, typeof int4 | typeof text>) {
  return {
    columns,
    foreignKeys: [],
    indexes: [],
    primaryKey: { columns: ['id'] },
    uniques: [],
  };
}

// Same bare table name (`users`) declared in two namespaces, plus a table
// that exists in only one namespace, so resolution must discriminate by
// namespace coordinate rather than fall back to a cross-namespace scan.
const twoNamespaceContract = {
  capabilities: {},
  target: 'postgres',
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        entries: { table: { users: table({ id: int4, email: text }), posts: table({ id: int4 }) } },
      },
      auth: {
        entries: {
          table: { users: table({ id: int4, token: text }), sessions: table({ id: int4 }) },
        },
      },
    },
  },
};

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: emptyAggregateRegistry,
  types: {},
  applyMutationDefaults: () => [],
};

const stubInferer = { inferCodec: () => 'pg/text@1' };

type TableHandle = { buildAst(): TableSource };
type TwoNamespaceDb = {
  public: { users: TableHandle; sessions: undefined };
  auth: { users: TableHandle; sessions: TableHandle };
};

function db() {
  return sql({
    context: {
      ...stubBase,
      contract: twoNamespaceContract,
    } as unknown as ExecutionContext<Contract>,
    rawCodecInferer: stubInferer,
  }) as unknown as TwoNamespaceDb;
}

describe('namespaced table resolution', () => {
  it('resolves the same bare name to the distinct table in each namespace', () => {
    expect(db().public.users.buildAst().namespaceId).toBe('public');
    expect(db().auth.users.buildAst().namespaceId).toBe('auth');
  });

  it('scopes table lookup to the named namespace, returning undefined for a foreign table', () => {
    // `sessions` exists only in `auth`.
    expect(db().public.sessions).toBeUndefined();
    expect(db().auth.sessions.buildAst().namespaceId).toBe('auth');
  });
});
