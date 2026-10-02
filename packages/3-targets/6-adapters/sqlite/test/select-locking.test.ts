import {
  ColumnRef,
  LockingClause,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createSqliteAdapter } from '../src/core/adapter';
import { sqliteAdapterDescriptorMeta } from '../src/core/descriptor-meta';
import type { SqliteContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            job: {
              columns: {
                id: { codecId: 'sqlite/integer@1', nativeType: 'integer', nullable: false },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as SqliteContract;

describe('SQLite adapter row locking', () => {
  const adapter = createSqliteAdapter();

  it('refuses a select carrying a locking clause', () => {
    const ast = SelectAst.from(TableSource.named('job'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('job', 'id'))])
      .withLocking([LockingClause.of('forUpdate')]);

    expect(() => adapter.lower(ast, { contract })).toThrow(
      expect.objectContaining({
        name: 'StructuredError',
        code: 'RUNTIME.AST_UNSUPPORTED',
        message:
          'SQLite has no row locks, so a select cannot carry a locking clause such as FOR UPDATE',
        meta: { target: 'sqlite', feature: 'locking-clause' },
      }),
    );
  });

  it.each([
    ['sql', 'forUpdate'],
    ['sql', 'forShare'],
    ['sql', 'lockOf'],
    ['sql', 'lockNowait'],
    ['sql', 'lockSkipLocked'],
    ['postgres', 'forNoKeyUpdate'],
    ['postgres', 'forKeyShare'],
  ])('does not report %s.%s', (group, flag) => {
    expect(adapter.profile.capabilities).not.toHaveProperty([group, flag]);
    expect(sqliteAdapterDescriptorMeta.capabilities).not.toHaveProperty([group, flag]);
  });
});
