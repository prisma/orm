import { coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import { ColumnRef, IdentifierRef } from '@internal/sql-relational-core/ast';
import { codecOf } from '@internal/sql-relational-core/expression';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../1-core/contract/test/test-support';
import { tableToScope } from '../../src/runtime/builder-base';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { joinedScope, usersScope } from './test-helpers';

describe('createFieldProxy', () => {
  it('top-level field access produces IdentifierRef', () => {
    const proxy = createFieldProxy(usersScope);
    const idExpr = proxy.id;

    expect(idExpr).toBeInstanceOf(ExpressionImpl);
    const ref = idExpr.buildAst();
    expect(ref).toBeInstanceOf(IdentifierRef);
    expect((ref as IdentifierRef).name).toBe('id');
    expect((idExpr as ExpressionImpl).returnType).toEqual({
      codecId: 'pg/int4@1',
      nullable: false,
      codec: { codecId: 'pg/int4@1' },
    });
  });

  it('namespaced field access produces ColumnRef', () => {
    const proxy = createFieldProxy(usersScope);
    const emailExpr = proxy.users.email;

    expect(emailExpr).toBeInstanceOf(ExpressionImpl);
    const col = emailExpr.buildAst() as ColumnRef;
    expect(col).toBeInstanceOf(ColumnRef);
    expect(col.table).toBe('users');
    expect(col.column).toBe('email');
  });

  it('handles joined scope with namespaced access', () => {
    const proxy = createFieldProxy(joinedScope);
    const usersCol = proxy.users.id.buildAst() as ColumnRef;
    const postsCol = proxy.posts.id.buildAst() as ColumnRef;

    expect(usersCol.table).toBe('users');
    expect(usersCol.column).toBe('id');
    expect(postsCol.table).toBe('posts');
    expect(postsCol.column).toBe('id');
  });

  it('returns undefined for unknown fields', () => {
    const proxy = createFieldProxy(usersScope);
    expect((proxy as Record<string, unknown>)['nonexistent']).toBeUndefined();
  });

  it('attaches codec metadata for top-level fields with a codec', () => {
    const proxy = createFieldProxy(usersScope);
    const idExpr = proxy.id as ExpressionImpl;

    expect(codecOf(idExpr)).toEqual(usersScope.topLevel.id.codec);
    expect(idExpr).not.toHaveProperty('codec');
  });

  it('tableToScope resolves codec by storage table name when alias differs', () => {
    const table: StorageTable = {
      columns: {
        embedding: {
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          nullable: false,
          typeRef: 'Embedding1536',
        },
      },
      primaryKey: { columns: ['embedding'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    };
    const storage = new SqlStorage({
      storageHash: coreHash('h'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: { Post: table },
          },
        }),
      },
      types: {
        Embedding1536: {
          kind: 'codec-instance',
          codecId: 'pgvector/vector@1',
          nativeType: 'vector',
          typeParams: { length: 1536 },
        },
      },
    });
    const scope = tableToScope('post_alias', table, {
      storage,
      namespaceId: UNBOUND_NAMESPACE_ID,
      tableName: 'Post',
    });
    const proxy = createFieldProxy(scope);
    for (const expression of [proxy['embedding'], proxy['post_alias']?.['embedding']]) {
      expect(codecOf(expression)).toEqual({
        codecId: 'pgvector/vector@1',
        typeParams: { length: 1536 },
      });
      expect(expression).not.toHaveProperty('codec');
    }
  });

  it('derives the declared codec for top-level fields without a codec ref', () => {
    const ambiguousScope = {
      topLevel: { name: { codecId: 'pg/text@1', nullable: false } },
      namespaces: {
        users: { name: { codecId: 'pg/text@1', nullable: false } },
        members: { name: { codecId: 'pg/text@1', nullable: false } },
      },
    } as const;
    const proxy = createFieldProxy(ambiguousScope);
    const nameExpr = proxy.name as ExpressionImpl;

    expect(codecOf(nameExpr)).toEqual({ codecId: 'pg/text@1' });
  });
});
