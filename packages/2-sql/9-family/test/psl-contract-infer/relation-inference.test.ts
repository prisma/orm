import { SqlTableIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferRelations } from '../../src/core/psl-contract-infer/relation-inference';

describe('inferRelations', () => {
  it('infers 1:N relation from FK', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      post: new SqlTableIR({
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    // Child table (post) should have relation field
    const postRelations = relationsByTable.get('post');
    expect(postRelations).toHaveLength(1);
    expect(postRelations![0]).toMatchObject({
      fieldName: 'user',
      typeName: 'User',
      list: false,
    });

    // Parent table (user) should have back-relation
    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      fieldName: 'posts',
      typeName: 'Post',
      list: true,
    });
  });

  it('detects 1:1 when FK column has unique constraint', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      profile: new SqlTableIR({
        name: 'profile',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [{ columns: ['user_id'] }],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['profile', 'Profile'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    // Back-relation should be optional (1:1), not a list
    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      optional: true,
      list: false,
    });
  });

  it('detects 1:1 when FK columns exactly match a total unique index', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      profile: new SqlTableIR({
        name: 'profile',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [
          {
            naming: { kind: 'exact', name: 'profile_user_id_idx' },
            columns: ['user_id'],
            where: undefined,
            unique: true,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['profile', 'Profile'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      optional: true,
      list: false,
    });
  });

  it('keeps a list back-relation when the only covering unique index is partial', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      draft: new SqlTableIR({
        name: 'draft',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [
          {
            naming: { kind: 'exact', name: 'draft_active_user_idx' },
            columns: ['user_id'],
            where: undefined,
            unique: true,
            partial: true,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['draft', 'Draft'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      optional: false,
      list: true,
    });
  });

  it('keeps a list back-relation when the unique index columns are a superset of the FK columns', () => {
    // A unique index on (user_id, name) does not make the FK on (user_id)
    // unique — only exact set equality between index and FK columns may
    // produce a 1:1, so the back-relation stays a list.
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      handle: new SqlTableIR({
        name: 'handle',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          name: { name: 'name', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [
          {
            naming: { kind: 'exact', name: 'handle_user_name_idx' },
            columns: ['user_id', 'name'],
            where: undefined,
            unique: true,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['handle', 'Handle'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      optional: false,
      list: true,
    });
  });

  it('detects 1:1 when FK columns match PK columns', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      user_detail: new SqlTableIR({
        name: 'user_detail',
        columns: {
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['user_id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['user_detail', 'UserDetail'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const userRelations = relationsByTable.get('user');
    expect(userRelations).toHaveLength(1);
    expect(userRelations![0]).toMatchObject({
      optional: true,
      list: false,
    });
  });

  it('detects 1:1 when composite FK columns match a composite unique constraint', () => {
    const tables: Record<string, SqlTableIR> = {
      account: new SqlTableIR({
        name: 'account',
        columns: {
          tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
          id: { name: 'id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['tenant_id', 'id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      profile: new SqlTableIR({
        name: 'profile',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
          account_id: { name: 'account_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['tenant_id', 'account_id'],
            referencedTable: 'account',
            referencedColumns: ['tenant_id', 'id'],
          },
        ],
        uniques: [{ columns: ['tenant_id', 'account_id'] }],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['account', 'Account'],
      ['profile', 'Profile'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const accountRelations = relationsByTable.get('account');
    expect(accountRelations).toHaveLength(1);
    expect(accountRelations![0]).toMatchObject({
      optional: true,
      list: false,
    });
  });

  it('produces named relations for multiple FKs to same parent', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      message: new SqlTableIR({
        name: 'message',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          sender_id: { name: 'sender_id', nativeType: 'int4', nullable: false },
          receiver_id: { name: 'receiver_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            name: 'fk_sender',
            columns: ['sender_id'],
            referencedTable: 'user',
            referencedColumns: ['id'],
          },
          {
            name: 'fk_receiver',
            columns: ['receiver_id'],
            referencedTable: 'user',
            referencedColumns: ['id'],
          },
        ],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['message', 'Message'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const messageRelations = relationsByTable.get('message');
    expect(messageRelations).toHaveLength(2);
    expect(messageRelations![0]).toMatchObject({ relationName: 'fk_sender', fkName: 'fk_sender' });
    expect(messageRelations![1]).toMatchObject({
      relationName: 'fk_receiver',
      fkName: 'fk_receiver',
    });
  });

  it('falls back to generated relation names for unnamed duplicate FKs', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      message: new SqlTableIR({
        name: 'message',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          sender_id: { name: 'sender_id', nativeType: 'int4', nullable: false },
          recipient_id: { name: 'recipient_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          { columns: ['sender_id'], referencedTable: 'user', referencedColumns: ['id'] },
          { columns: ['recipient_id'], referencedTable: 'user', referencedColumns: ['id'] },
        ],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['message', 'Message'],
    ]);

    const { relationsByTable } = inferRelations(tables, modelNameMap);
    const messageRelations = relationsByTable.get('message');

    expect(messageRelations).toHaveLength(2);
    expect(messageRelations![0]).toMatchObject({ relationName: 'sender_id' });
    expect(messageRelations![1]).toMatchObject({ relationName: 'recipient_id' });
  });

  it('handles self-referencing FKs', () => {
    const tables: Record<string, SqlTableIR> = {
      category: new SqlTableIR({
        name: 'category',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          parent_id: { name: 'parent_id', nativeType: 'int4', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          { columns: ['parent_id'], referencedTable: 'category', referencedColumns: ['id'] },
        ],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([['category', 'Category']]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const relations = relationsByTable.get('category');
    expect(relations).toHaveLength(2); // child + back-relation
    // Child relation field
    const childRel = relations!.find((r) => r.fields);
    expect(childRel).toMatchObject({
      fieldName: 'parent',
      typeName: 'Category',
      optional: true,
      relationName: 'ParentCategories',
    });
    // Back-relation field
    const backRel = relations!.find((r) => !r.fields);
    expect(backRel).toMatchObject({
      typeName: 'Category',
      list: true,
      relationName: 'ParentCategories',
    });
  });

  it('includes onDelete/onUpdate when non-default', () => {
    const tables: Record<string, SqlTableIR> = {
      parent: new SqlTableIR({
        name: 'parent',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      child: new SqlTableIR({
        name: 'child',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          parent_id: { name: 'parent_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['parent_id'],
            referencedTable: 'parent',
            referencedColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'setNull',
          },
        ],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['parent', 'Parent'],
      ['child', 'Child'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const childRelations = relationsByTable.get('child');
    expect(childRelations![0]).toMatchObject({
      onDelete: 'Cascade',
      onUpdate: 'SetNull',
    });
  });

  it('falls back to table names and creates parent relation state when the model map is incomplete', () => {
    const tables: Record<string, SqlTableIR> = {
      audit: new SqlTableIR({
        name: 'audit',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          owner_id: { name: 'owner_id', nativeType: 'int4', nullable: false },
          marker: { name: 'marker', nativeType: 'text', nullable: false },
        },
        foreignKeys: [
          { columns: ['owner_id'], referencedTable: 'user', referencedColumns: ['id'] },
        ],
        uniques: [{ columns: ['marker'] }],
        indexes: [],
      }),
    };

    const { relationsByTable } = inferRelations(tables, new Map());

    expect(relationsByTable.get('audit')![0]).toMatchObject({
      fieldName: 'owner',
      typeName: 'user',
      relationName: undefined,
      optional: false,
      list: false,
    });
    expect(relationsByTable.get('user')![0]).toMatchObject({
      fieldName: 'audits',
      typeName: 'audit',
      relationName: undefined,
      optional: false,
      list: true,
    });
  });

  it('stamps index: false when the FK columns have no live backing index', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      post: new SqlTableIR({
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const postRelations = relationsByTable.get('post');
    expect(postRelations![0]).toMatchObject({ fieldName: 'user', index: false });
  });

  it('leaves index unset when a live non-unique index backs the FK columns', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      post: new SqlTableIR({
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [
          {
            naming: { kind: 'exact', name: 'profile_user_id_plain_idx' },
            columns: ['user_id'],
            where: undefined,
            unique: false,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const postRelations = relationsByTable.get('post');
    expect(postRelations![0]?.index).toBeUndefined();
  });

  it('stamps index: false when a live index exists but in a different column order', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: {
          tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
          id: { name: 'id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['tenant_id', 'id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      post: new SqlTableIR({
        name: 'post',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          tenant_id: { name: 'tenant_id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['tenant_id', 'user_id'],
            referencedTable: 'user',
            referencedColumns: ['tenant_id', 'id'],
          },
        ],
        uniques: [],
        // Same columns, reversed order: does not satisfy the FK's (tenant_id, user_id) order.
        indexes: [
          {
            naming: { kind: 'exact', name: 'membership_user_tenant_idx' },
            columns: ['user_id', 'tenant_id'],
            where: undefined,
            unique: false,
            partial: false,
            type: undefined,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]);
    const { relationsByTable } = inferRelations(tables, modelNameMap);

    const postRelations = relationsByTable.get('post');
    expect(postRelations![0]).toMatchObject({ index: false });
  });

  it('falls back to a numeric suffix when relation names still collide after appending the model name', () => {
    const tables: Record<string, SqlTableIR> = {
      user: new SqlTableIR({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
      audit: new SqlTableIR({
        name: 'audit',
        columns: {
          id: { name: 'id', nativeType: 'int4', nullable: false },
          user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          user: { name: 'user', nativeType: 'text', nullable: false },
          userUser: { name: 'userUser', nativeType: 'text', nullable: false },
          user2: { name: 'user2', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
        uniques: [],
        indexes: [],
      }),
    };
    const modelNameMap = new Map([
      ['user', 'User'],
      ['audit', 'Audit'],
    ]);

    const { relationsByTable } = inferRelations(tables, modelNameMap);
    expect(relationsByTable.get('audit')![0]).toMatchObject({
      fieldName: 'user3',
      typeName: 'User',
    });
  });
});
