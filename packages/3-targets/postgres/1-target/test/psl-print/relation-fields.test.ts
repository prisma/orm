import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { buildModels, fieldText, INT_COLUMN, table } from './print-support';

describe('relations', () => {
  function postAndUser(
    foreignKey: Record<string, unknown>,
    keys: {
      readonly indexes?: readonly unknown[];
      readonly uniques?: readonly unknown[];
      readonly primaryKey?: { readonly columns: readonly string[]; readonly name?: string };
    } = {},
  ) {
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
          primaryKey: keys.primaryKey ?? { columns: ['id'] },
          indexes: keys.indexes ?? [],
          uniques: keys.uniques ?? [],
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

  it('names an index the default backing index would not be', () => {
    const models = postAndUser(
      { index: { name: 'post_author_live_29e42dbc' } },
      {
        indexes: [
          {
            name: 'post_author_live_29e42dbc',
            prefix: 'post_author_live',
            columns: ['authorId'],
            where: 'id > 0',
            unique: false,
          },
        ],
      },
    );
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], index: "post_author_live")',
    );
  });

  it('writes no index argument when the default backing index is the index that backs the foreign key', () => {
    const models = postAndUser(
      { index: { name: 'post_authorId_idx_e47547ed' } },
      {
        indexes: [
          {
            name: 'post_authorId_idx_e47547ed',
            prefix: 'post_authorId_idx',
            columns: ['authorId'],
            unique: false,
          },
        ],
      },
    );
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id])',
    );
  });

  it('names a unique constraint whose first columns are the foreign key columns', () => {
    const models = postAndUser(
      { index: { unique: ['authorId', 'id'] } },
      {
        uniques: [
          { columns: ['authorId'], name: 'post_author_only_key' },
          { columns: ['authorId', 'id'], name: 'post_author_key' },
        ],
      },
    );
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id], index: "post_author_key")',
    );
  });

  it('writes no index argument when a unique constraint backs the foreign key', () => {
    const models = postAndUser(
      { index: { unique: ['authorId'] } },
      { uniques: [{ columns: ['authorId'] }] },
    );
    expect(models[1]?.fields.map(fieldText)[2]).toBe(
      'author User @relation(fields: [authorId], references: [id])',
    );
  });

  it.each([
    ['primary key', { primaryKey: { columns: ['authorId', 'id'] } }, { primaryKey: true }],
    [
      'unique constraint',
      { uniques: [{ columns: ['authorId', 'id'] }] },
      { unique: ['authorId', 'id'] },
    ],
  ] as const)(
    'refuses a foreign key backed by an unnamed %s that only starts with its columns',
    (_label, keys, index) => {
      expect(() => postAndUser({ index }, keys)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PRINT_UNSUPPORTED',
          meta: { model: 'Post', field: 'author' },
        }),
      );
    },
  );

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
