import type { ContractToOneRelation } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { col, fk, table } from '../src/factories';
import { SqlStorage } from '../src/ir/sql-storage';
import { resolveSqlToOneRelationStorage } from '../src/relation-storage';
import { createTestSqlNamespace } from './test-support';

function makeRelation(overrides: {
  cardinality: '1:1' | 'N:1';
  localFields: readonly string[];
}): ContractToOneRelation {
  return {
    to: {} as never,
    cardinality: overrides.cardinality,
    nullable: false,
    on: { localFields: overrides.localFields, targetFields: ['id'] },
  };
}

describe('resolveSqlToOneRelationStorage', () => {
  it('resolves a mapped, non-nullable column for an existing field', () => {
    const usersTable = table({
      id: col('int4', 'pg/int4@1'),
      author_id: col('int4', 'pg/int4@1'),
    });
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { posts: usersTable } },
        }),
      },
    });
    const modelStorage = {
      table: 'posts',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: { authorId: { column: 'author_id' } },
    };
    const relation = makeRelation({ cardinality: 'N:1', localFields: ['authorId'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.columns).toEqual([{ name: 'author_id', nullable: false }]);
    expect(result.ownsForeignKey).toBe(true);
  });

  it('falls back to the field name and treats the column as nullable when the field has no column mapping', () => {
    const usersTable = table({ id: col('int4', 'pg/int4@1') });
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { posts: usersTable } },
        }),
      },
    });
    const modelStorage = {
      table: 'posts',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: {},
    };
    const relation = makeRelation({ cardinality: 'N:1', localFields: ['missingField'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.columns).toEqual([{ name: 'missingField', nullable: true }]);
  });

  it('falls back to the field name and treats the column as nullable when the field maps to a missing table column', () => {
    const usersTable = table({ id: col('int4', 'pg/int4@1') });
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { posts: usersTable } },
        }),
      },
    });
    const modelStorage = {
      table: 'posts',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: { authorId: { column: 'author_id' } },
    };
    const relation = makeRelation({ cardinality: 'N:1', localFields: ['authorId'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.columns).toEqual([{ name: 'author_id', nullable: true }]);
  });

  it('does not own the foreign key for a 1:1 relation whose table declares no matching foreign key', () => {
    const usersTable = table({ id: col('int4', 'pg/int4@1') });
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { profiles: usersTable } },
        }),
      },
    });
    const modelStorage = {
      table: 'profiles',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: { id: { column: 'id' } },
    };
    const relation = makeRelation({ cardinality: '1:1', localFields: ['id'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.ownsForeignKey).toBe(false);
  });

  it('owns the foreign key for a 1:1 relation whose table declares a matching foreign key', () => {
    const foreignKey = fk('profiles', ['user_id'], 'users', ['id']);
    const profilesTable = table(
      { id: col('int4', 'pg/int4@1'), user_id: col('int4', 'pg/int4@1') },
      { fks: [foreignKey] },
    );
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { profiles: profilesTable } },
        }),
      },
    });
    const modelStorage = {
      table: 'profiles',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: { userId: { column: 'user_id' } },
    };
    const relation = makeRelation({ cardinality: '1:1', localFields: ['userId'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.ownsForeignKey).toBe(true);
  });

  it('does not own the foreign key when the referenced table is entirely missing', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as never,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: {} },
        }),
      },
    });
    const modelStorage = {
      table: 'missing_table',
      namespaceId: UNBOUND_NAMESPACE_ID,
      fields: {},
    };
    const relation = makeRelation({ cardinality: '1:1', localFields: ['x'] });

    const result = resolveSqlToOneRelationStorage({ storage } as never, modelStorage, relation);

    expect(result.ownsForeignKey).toBe(false);
  });
});
