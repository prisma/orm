import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { col, fk, index, model, pk, table, unique } from '../src/factories';

describe('SQL contract factories', () => {
  describe('col', () => {
    it('creates a StorageColumn with nativeType, codecId and nullable', () => {
      const column = col('int4', 'pg/int4@1', false);
      expect(column).toEqual({
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
        many: false,
      });
    });

    it('defaults nullable to false', () => {
      const column = col('text', 'pg/text@1');
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: false,
        many: false,
      });
    });

    it('creates nullable column', () => {
      const column = col('text', 'pg/text@1', true);
      expect(column).toEqual({
        nativeType: 'text',
        codecId: 'pg/text@1',
        nullable: true,
        many: false,
      });
    });
  });

  describe('pk', () => {
    it('creates a PrimaryKey with columns', () => {
      const primaryKey = pk('id');
      expect(primaryKey).toEqual({
        columns: ['id'],
      });
    });

    it('creates composite primary key', () => {
      const primaryKey = pk('id', 'tenantId');
      expect(primaryKey).toEqual({
        columns: ['id', 'tenantId'],
      });
    });

    it('creates primary key with name', () => {
      const primaryKey = pk('id');
      expect(primaryKey.columns).toEqual(['id']);
      // name is optional and can be set via object spread if needed
      const withName = { ...primaryKey, name: 'user_pkey' };
      expect(withName.name).toBe('user_pkey');
    });
  });

  describe('unique', () => {
    it('creates a UniqueConstraint with columns', () => {
      const uniqueConstraint = unique('email');
      expect(uniqueConstraint).toEqual({
        columns: ['email'],
      });
    });

    it('creates composite unique constraint', () => {
      const uniqueConstraint = unique('userId', 'postId');
      expect(uniqueConstraint).toEqual({
        columns: ['userId', 'postId'],
      });
    });
  });

  describe('index', () => {
    it('creates an exact-named Index with columns', () => {
      const idx = index('user_email_idx', ['email']);
      expect(idx).toEqual({
        name: 'user_email_idx',
        columns: ['email'],
        unique: false,
      });
    });

    it('creates composite index', () => {
      const idx = index('user_userId_createdAt_idx', ['userId', 'createdAt']);
      expect(idx).toEqual({
        name: 'user_userId_createdAt_idx',
        columns: ['userId', 'createdAt'],
        unique: false,
      });
    });

    it('creates a wire-named index when a prefix is given', () => {
      const idx = index('user_email_idx_deadbeef', ['email'], { prefix: 'user_email_idx' });
      expect(idx).toEqual({
        name: 'user_email_idx_deadbeef',
        prefix: 'user_email_idx',
        columns: ['email'],
        unique: false,
      });
    });
  });

  describe('fk', () => {
    it('creates a ForeignKey', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id']);
      expect(foreignKey).toEqual({
        source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
      });
    });

    it('creates foreign key with name', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id'], { name: 'user_posts_fkey' });
      expect(foreignKey).toEqual({
        source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        name: 'user_posts_fkey',
      });
    });

    it('creates composite foreign key', () => {
      const foreignKey = fk('post', ['tenantId', 'userId'], 'user', ['tenantId', 'id']);
      expect(foreignKey).toEqual({
        source: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          tableName: 'post',
          columns: ['tenantId', 'userId'],
        },
        target: {
          namespaceId: UNBOUND_NAMESPACE_ID,
          tableName: 'user',
          columns: ['tenantId', 'id'],
        },
      });
    });

    it('creates foreign key with onDelete via options object', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade' });
      expect(foreignKey).toEqual({
        source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        onDelete: 'cascade',
      });
    });

    it('creates foreign key with onDelete and onUpdate', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id'], {
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      expect(foreignKey).toEqual({
        source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
    });

    it('creates foreign key with name and referential actions via options', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id'], {
        name: 'post_userId_fkey',
        onDelete: 'setNull',
        onUpdate: 'cascade',
      });
      expect(foreignKey).toEqual({
        source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
        target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        name: 'post_userId_fkey',
        onDelete: 'setNull',
        onUpdate: 'cascade',
      });
    });

    it.each(['noAction', 'restrict', 'cascade', 'setNull', 'setDefault'] as const)(
      'accepts %s as a referential action',
      (action) => {
        const foreignKey = fk('post', ['userId'], 'user', ['id'], { onDelete: action });
        expect(foreignKey.onDelete).toBe(action);
      },
    );

    it('omits undefined referential actions from output', () => {
      const foreignKey = fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade' });
      expect(foreignKey).not.toHaveProperty('onUpdate');
    });
  });

  describe('table', () => {
    it('creates a StorageTable with columns', () => {
      const userTable = table({
        id: col('int4', 'pg/int4@1'),
        email: col('text', 'pg/text@1'),
      });
      expect(userTable.columns).toEqual({
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false, many: false },
        email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: false },
      });
      expect(userTable.uniques).toEqual([]);
      expect(userTable.indexes).toEqual([]);
      expect(userTable.foreignKeys).toEqual([]);
    });

    it('creates table with primary key', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { pk: pk('id') },
      );
      expect(userTable.primaryKey).toEqual({ columns: ['id'] });
    });

    it('creates table with unique constraints', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { uniques: [unique('email')] },
      );
      expect(userTable.uniques).toEqual([{ columns: ['email'] }]);
    });

    it('creates table with indexes', () => {
      const userTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          email: col('text', 'pg/text@1'),
        },
        { indexes: [index('user_email_idx', ['email'])] },
      );
      expect(userTable.indexes).toEqual([
        { name: 'user_email_idx', columns: ['email'], unique: false },
      ]);
    });

    it('creates table with foreign keys', () => {
      const postTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          userId: col('int4', 'pg/int4@1'),
        },
        { fks: [fk('post', ['userId'], 'user', ['id'])] },
      );
      expect(postTable.foreignKeys).toEqual([
        {
          source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        },
      ]);
    });

    it('creates table with all constraints', () => {
      const postTable = table(
        {
          id: col('int4', 'pg/int4@1'),
          userId: col('int4', 'pg/int4@1'),
          title: col('text', 'pg/text@1'),
        },
        {
          pk: pk('id'),
          uniques: [unique('title')],
          indexes: [index('post_userId_idx', ['userId'])],
          fks: [fk('post', ['userId'], 'user', ['id'])],
        },
      );
      expect(postTable.primaryKey).toEqual({ columns: ['id'] });
      expect(postTable.uniques).toEqual([{ columns: ['title'] }]);
      expect(postTable.indexes).toEqual([
        { name: 'post_userId_idx', columns: ['userId'], unique: false },
      ]);
      expect(postTable.foreignKeys).toEqual([
        {
          source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['userId'] },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        },
      ]);
    });
  });

  describe('model', () => {
    it('creates model storage fields and domain fields without optional properties', () => {
      const userModel = model('user', {
        id: { column: 'id' },
        email: { column: 'email' },
      });
      expect(userModel).toEqual({
        storage: {
          table: 'user',
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
        fields: {
          id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'core/unknown@1' } },
          email: {
            nullable: false,
            many: false,
            type: { kind: 'scalar', codecId: 'core/unknown@1' },
          },
        },
        relations: {},
      });
    });

    it('propagates codecId and nullable from storage fields to domain fields', () => {
      const userModel = model('user', {
        id: { column: 'id', codecId: 'pg/int4@1', nullable: false },
        name: { column: 'name', codecId: 'pg/text@1', nullable: true },
        email: { column: 'email' },
      });
      expect(userModel.fields).toEqual({
        id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
        name: { nullable: true, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        email: {
          nullable: false,
          many: false,
          type: { kind: 'scalar', codecId: 'core/unknown@1' },
        },
      });
    });

    it('creates model with relations', () => {
      const userModel = model(
        'user',
        {
          id: { column: 'id' },
        },
        {
          posts: { kind: 'oneToMany', model: 'Post', foreignKey: 'userId' },
        },
      );
      expect(userModel.storage.table).toBe('user');
      expect(userModel.storage.fields).toEqual({ id: { column: 'id' } });
      expect(userModel.fields).toEqual({
        id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'core/unknown@1' } },
      });
      expect(userModel.relations).toEqual({
        posts: { kind: 'oneToMany', model: 'Post', foreignKey: 'userId' },
      });
    });
  });
});
