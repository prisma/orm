import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage, type StorageTableInput } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { createStubAdapter, createTestContext } from './utils';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'pg/int4@1': 'pg/int4',
  'pg/text@1': 'pg/text',
  'sql/varchar@1': 'pg/varchar',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

function table(columns: Record<string, string>): StorageTableInput {
  return {
    columns: Object.fromEntries(
      Object.entries(columns).map(([name, codecId]) => [
        name,
        { dataType: dataTypeOf(codecId), codecId, nullable: false },
      ]),
    ),
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// Both namespaces declare a table with the same bare name `users` but with
// differing columns/codecs. The execution-context codec registry pre-walks every
// table across every namespace, so the two same-bare-named tables must not
// collide — resolution discriminates by the namespace coordinate.
function twoNamespaceContract(): Contract<SqlStorage> {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('test'),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    storage: new SqlStorage({
      storageHash: coreHash('test'),
      namespaces: {
        public: createTestSqlNamespace({
          id: 'public',
          entries: { table: { users: table({ id: 'pg/int4@1', email: 'pg/text@1' }) } },
        }),
        auth: createTestSqlNamespace({
          id: 'auth',
          entries: { table: { users: table({ id: 'pg/int4@1', token: 'sql/varchar@1' }) } },
        }),
      },
    }),
    extensions: {},
    capabilities: {},
    meta: {},
  };
}

describe('same bare table name across namespaces — execution context', () => {
  it('loads through createExecutionContext without throwing an ambiguity error', () => {
    expect(() => createTestContext(twoNamespaceContract(), createStubAdapter())).not.toThrow();
  });

  it('resolves the per-namespace column codec via the coordinate, discriminating per namespace', () => {
    const context = createTestContext(twoNamespaceContract(), createStubAdapter());

    expect(context.contractCodecs.forColumn('public', 'users', 'email')?.id).toBe('pg/text@1');
    expect(context.contractCodecs.forColumn('auth', 'users', 'token')?.id).toBe('sql/varchar@1');

    // A column present only in the other namespace must not resolve here — proves
    // resolution honours the coordinate rather than first-matching by bare name.
    expect(context.contractCodecs.forColumn('public', 'users', 'token')).toBeUndefined();
    expect(context.contractCodecs.forColumn('auth', 'users', 'email')).toBeUndefined();
  });

  it('exposes the per-namespace codec ref through the descriptor registry coordinate', () => {
    const context = createTestContext(twoNamespaceContract(), createStubAdapter());

    expect(context.codecDescriptors.codecRefForColumn('public', 'users', 'email')).toEqual({
      codecId: 'pg/text@1',
    });
    expect(context.codecDescriptors.codecRefForColumn('auth', 'users', 'token')).toEqual({
      codecId: 'sql/varchar@1',
    });
  });
});
