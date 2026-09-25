import type { MutationDefaultsOptions } from '@internal/framework-components/runtime';
import type {
  InsertAst,
  ProjectionItem,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import type { Contract } from '../fixtures/generated/contract';

/** No target contributes aggregates to these plan-shape cases; resolution answers nothing and the codec slot stays empty. */
const emptyAggregateRegistry = {
  resolve: () => undefined,
  values: function* () {},
};

function column(codecId: string) {
  return { codecId, nativeType: codecId, nullable: false } as const;
}

function table(columns: Record<string, ReturnType<typeof column>>) {
  return {
    columns,
    foreignKeys: [],
    indexes: [],
    primaryKey: { columns: ['id'] },
    uniques: [],
  };
}

// Both namespaces declare a table with the same bare name `users` but with
// differing columns/codecs, so column/codec resolution must discriminate by
// the namespace coordinate the proxy carries.
const twoNamespaceContract = {
  capabilities: {},
  target: 'postgres',
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: {
          table: { users: table({ id: column('pg/int4@1'), email_addr: column('pg/text@1') }) },
        },
      },
      auth: {
        id: 'auth',
        entries: {
          table: { users: table({ id: column('pg/int4@1'), token_col: column('pg/varchar@1') }) },
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

type FieldProxyStub = { id: unknown };
type FnsStub = { eq(field: unknown, value: unknown): unknown };
type TableHandle = {
  select(column: string): { build(): { ast: SelectAst } };
  insert(rows: ReadonlyArray<Record<string, unknown>>): { build(): { ast: InsertAst } };
  update(set: (fields: FieldProxyStub) => Record<string, unknown>): {
    where(predicate: (fields: FieldProxyStub, fns: FnsStub) => unknown): {
      build(): { ast: UpdateAst };
    };
  };
};
type TwoNamespaceDb = {
  public: { users: TableHandle };
  auth: { users: TableHandle };
};

function db() {
  return sql({
    context: {
      ...stubBase,
      contract: twoNamespaceContract,
    } as unknown as ExecutionContext<Contract>,
    rawCodecInferer: { inferCodec: () => 'pg/text@1' },
  }) as unknown as TwoNamespaceDb;
}

function projectionCodecId(ast: SelectAst): string | undefined {
  const projection = (ast as unknown as { projection: ProjectionItem[] }).projection[0];
  return (projection as unknown as { codec?: { codecId: string } }).codec?.codecId;
}

function insertParamCodecId(ast: InsertAst, column: string): string | undefined {
  const value = ast.rows[0]?.[column];
  return (value as unknown as { codec?: { codecId: string } } | undefined)?.codec?.codecId;
}

describe('same bare table name across namespaces', () => {
  it('resolves the column codec within the proxy namespace, discriminating per namespace', () => {
    const publicAst = db().public.users.select('email_addr').build().ast;
    expect(projectionCodecId(publicAst)).toBe('pg/text@1');
    expect((publicAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe(
      'public',
    );

    const authAst = db().auth.users.select('token_col').build().ast;
    expect(projectionCodecId(authAst)).toBe('pg/varchar@1');
    expect((authAst as unknown as { from: { namespaceId: string } }).from.namespaceId).toBe('auth');
  });

  it('resolves insert param codecs within the proxy namespace, discriminating per namespace', () => {
    const publicInsert = db()
      .public.users.insert([{ id: 1, email_addr: 'a@example.com' }])
      .build().ast;
    expect(insertParamCodecId(publicInsert, 'email_addr')).toBe('pg/text@1');
    expect(insertParamCodecId(publicInsert, 'id')).toBe('pg/int4@1');
    expect(publicInsert.table.namespaceId).toBe('public');

    const authInsert = db()
      .auth.users.insert([{ id: 2, token_col: 'tok' }])
      .build().ast;
    expect(insertParamCodecId(authInsert, 'token_col')).toBe('pg/varchar@1');
    expect(insertParamCodecId(authInsert, 'id')).toBe('pg/int4@1');
    expect(authInsert.table.namespaceId).toBe('auth');
  });

  // Regression: execution-default refs are namespace-scoped, so the builder must
  // forward the proxy's namespace to `applyMutationDefaults`. With two same-named
  // `users` tables whose execution defaults differ by namespace, each write must
  // pick up *its own* namespace's default and not the collision twin's. Before the
  // builder forwarded `namespace`, the matcher saw `namespace === undefined` and
  // either applied the wrong namespace's default or none at all.
  function namespacedDefaultsDb() {
    const applyMutationDefaults = (options: MutationDefaultsOptions) => {
      if (options.entry !== 'users') return [];
      if (options.namespace === 'public' && !('email_addr' in options.values)) {
        return [{ field: 'email_addr', value: 'public-default' }];
      }
      if (options.namespace === 'auth' && !('token_col' in options.values)) {
        return [{ field: 'token_col', value: 'auth-default' }];
      }
      return [];
    };
    return sql({
      context: {
        ...stubBase,
        applyMutationDefaults,
        contract: twoNamespaceContract,
      } as unknown as ExecutionContext<Contract>,
      rawCodecInferer: { inferCodec: () => 'pg/text@1' },
    }) as unknown as TwoNamespaceDb;
  }

  it('forwards the proxy namespace so execution defaults disambiguate same-named tables (insert)', () => {
    const publicInsert = namespacedDefaultsDb()
      .public.users.insert([{ id: 1 }])
      .build().ast;
    const authInsert = namespacedDefaultsDb()
      .auth.users.insert([{ id: 2 }])
      .build().ast;

    expect(Object.keys(publicInsert.rows[0]!).sort()).toEqual(['email_addr', 'id']);
    expect(Object.keys(authInsert.rows[0]!).sort()).toEqual(['id', 'token_col']);
  });

  it('forwards the proxy namespace so execution defaults disambiguate same-named tables (update)', () => {
    const publicUpdate = namespacedDefaultsDb()
      .public.users.update((f) => ({ id: f.id }))
      .where((f, fns) => fns.eq(f.id, 1))
      .build().ast;
    const authUpdate = namespacedDefaultsDb()
      .auth.users.update((f) => ({ id: f.id }))
      .where((f, fns) => fns.eq(f.id, 2))
      .build().ast;

    expect(Object.keys(publicUpdate.set).sort()).toEqual(['email_addr', 'id']);
    expect(Object.keys(authUpdate.set).sort()).toEqual(['id', 'token_col']);
  });
});
