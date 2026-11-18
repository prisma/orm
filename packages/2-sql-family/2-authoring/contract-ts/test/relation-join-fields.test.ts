import { describe, expect, it } from 'vitest';
import type { ModelNode, RelationNode } from '../src/contract-definition';
import { build, definitionOf, field } from './table-node-helpers';

const legacyId = {
  columnName: 'legacy_id',
  descriptor: { codecId: 'pg/int4@1' },
  nullable: false,
};

function user(relations: readonly RelationNode[]): ModelNode {
  return {
    modelName: 'User',
    tableName: 'users',
    fields: [field('id')],
    id: { columns: ['id'] },
    relations,
  };
}

const post: ModelNode = {
  modelName: 'Post',
  tableName: 'posts',
  fields: [field('id'), field('userId', 'pg/int4@1', { columnName: 'user_id' })],
  id: { columns: ['id'] },
};

const tag: ModelNode = {
  modelName: 'Tag',
  tableName: 'tags',
  fields: [field('id')],
  id: { columns: ['id'] },
};

const userTag: ModelNode = {
  modelName: 'UserTag',
  tableName: 'user_tags',
  fields: [
    field('userId', 'pg/int4@1', { columnName: 'user_id' }),
    field('tagId', 'pg/int4@1', { columnName: 'tag_id' }),
  ],
  id: { columns: ['user_id', 'tag_id'] },
};

function posts(parentColumns: readonly string[], childColumns: readonly string[]): RelationNode {
  return {
    fieldName: 'posts',
    toModel: 'Post',
    toTable: 'posts',
    cardinality: '1:N',
    on: { parentTable: 'users', parentColumns, childTable: 'posts', childColumns },
  };
}

describe('a relation join column', () => {
  it('lowers to the field that maps it', () => {
    const contract = build(definitionOf([user([posts(['id'], ['user_id'])]), post]));
    expect(contract.domain.namespaces['public']?.models['User']?.relations['posts']).toMatchObject({
      on: { localFields: ['id'], targetFields: ['userId'] },
    });
  });

  it('is refused on the local side when no field maps it', () => {
    expect(() =>
      build(
        definitionOf([user([posts(['legacy_id'], ['user_id'])]), post], {
          tables: [{ tableName: 'users', columns: [legacyId] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "User.posts" joins on column "legacy_id" of table "users", which no field of model "User" maps. A relation joins on fields; declare a field for the column.',
        meta: {
          modelName: 'User',
          relationName: 'posts',
          column: 'legacy_id',
          reason: 'join-column-not-a-field',
        },
      }),
    );
  });

  it('is refused on the target side when no field maps it', () => {
    expect(() =>
      build(
        definitionOf([user([posts(['id'], ['legacy_id'])]), post], {
          tables: [{ tableName: 'posts', columns: [legacyId] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "User.posts" joins on column "legacy_id" of table "posts", which no field of model "Post" maps. A relation joins on fields; declare a field for the column.',
      }),
    );
  });

  it('may name a junction table column on the target side of a many-to-many relation', () => {
    const tags: RelationNode = {
      fieldName: 'tags',
      toModel: 'Tag',
      toTable: 'tags',
      cardinality: 'N:M',
      on: {
        parentTable: 'users',
        parentColumns: ['id'],
        childTable: 'tags',
        childColumns: ['user_id'],
      },
      through: { table: 'user_tags', parentColumns: ['user_id'], childColumns: ['tag_id'] },
    };
    const contract = build(definitionOf([user([tags]), tag, userTag]));
    expect(contract.domain.namespaces['public']?.models['User']?.relations['tags']).toMatchObject({
      on: { localFields: ['id'], targetFields: ['user_id'] },
    });
  });

  it('is refused on the local side of a cross-space relation when no field maps it', () => {
    const account: RelationNode = {
      fieldName: 'account',
      toModel: 'Account',
      toTable: undefined,
      cardinality: 'N:1',
      nullable: true,
      spaceId: 'billing',
      namespaceId: 'public',
      on: {
        parentTable: 'users',
        parentColumns: ['legacy_id'],
        childTable: undefined,
        childColumns: ['id'],
      },
    };
    expect(() =>
      build(
        definitionOf([user([account])], {
          tables: [{ tableName: 'users', columns: [{ ...legacyId, nullable: true }] }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.RELATION_INVALID',
        message:
          'Relation "User.account" joins on column "legacy_id" of table "users", which no field of model "User" maps. A relation joins on fields; declare a field for the column.',
      }),
    );
  });
});
