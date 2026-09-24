import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { buildModels, fieldText, INT_COLUMN, table } from './print-support';

describe('relations', () => {
  function postAndUser(foreignKey: Record<string, unknown>) {
    return buildModels({
      models: {
        User: {
          table: 'user',
          fields: { id: { column: 'id' } },
          relations: {
            posts: {
              to: { namespace: asNamespaceId('public'), model: 'Post' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['authorId'] },
            },
          },
        },
        Post: {
          table: 'post',
          fields: { id: { column: 'id' }, authorId: { column: 'authorId' } },
          relations: {
            author: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['id'] },
            },
          },
        },
      },
      tables: {
        user: table({ columns: { id: INT_COLUMN }, primaryKey: { columns: ['id'] } }),
        post: table({
          columns: { id: INT_COLUMN, authorId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
              ...foreignKey,
            },
          ],
        }),
      },
    });
  }

  it('writes both referential actions and declines a backing index', () => {
    const models = postAndUser({ onDelete: 'cascade', onUpdate: 'restrict' });
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Restrict, index: false)',
    );
  });

  it('writes the foreign key name when the key carries one, and no action the key does not', () => {
    const models = postAndUser({ name: 'post_author_fkey' });
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], map: "post_author_fkey", index: false)',
    );
  });

  it('prints the other side as a list with no arguments', () => {
    const models = postAndUser({ onDelete: 'cascade', onUpdate: 'cascade' });
    expect(models[0]?.fields.map(fieldText)[1]).toBe('posts Post[]');
  });

  it('takes its actions from the foreign key that references the columns the relation names', () => {
    const models = buildModels({
      models: {
        User: {
          table: 'user',
          fields: { id: { column: 'id' }, altId: { column: 'altId' } },
          relations: {},
        },
        Post: {
          table: 'post',
          fields: { id: { column: 'id' }, authorId: { column: 'authorId' } },
          relations: {
            author: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['altId'] },
            },
            authorById: {
              to: { namespace: asNamespaceId('public'), model: 'User' },
              cardinality: 'N:1',
              nullable: false,
              on: { localFields: ['authorId'], targetFields: ['id'] },
            },
          },
        },
      },
      tables: {
        user: table({
          columns: { id: INT_COLUMN, altId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['altId'], name: 'user_altId_key' }],
        }),
        post: table({
          columns: { id: INT_COLUMN, authorId: INT_COLUMN },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
              name: 'post_author_id_fkey',
              onDelete: 'cascade',
              onUpdate: 'cascade',
            },
            {
              source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
              target: { namespaceId: 'public', tableName: 'user', columns: ['altId'] },
              name: 'post_author_altId_fkey',
              onDelete: 'restrict',
              onUpdate: 'restrict',
            },
          ],
        }),
      },
    });

    expect(models[1]?.fields.map(fieldText).slice(2)).toEqual([
      'author User @relation(name: "Post_author", fields: [authorId], references: [altId], onDelete: Restrict, onUpdate: Restrict, map: "post_author_altId_fkey", index: false)',
      'authorById User @relation(name: "Post_authorById", fields: [authorId], references: [id], onDelete: Cascade, onUpdate: Cascade, map: "post_author_id_fkey", index: false)',
    ]);
  });
});
