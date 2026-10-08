import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { col, fk, index, table, unique } from '../src/factories';
import { ForeignKey, type ForeignKeyIndex } from '../src/ir/foreign-key';
import { ForeignKeySchema } from '../src/ir/storage-entry-schemas';
import type { SqlStorage } from '../src/types';
import { validateStorageSemantics } from '../src/validators';

function postStorage(
  constraints: Omit<NonNullable<Parameters<typeof table>[1]>, 'fks'>,
  foreignKeyIndex: ForeignKeyIndex,
) {
  return createContract<SqlStorage>({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          kind: 'test-sql-namespace',
          entries: {
            table: {
              user: table({ id: col('pg/int4', 'pg/int4@1') }, { pk: { columns: ['id'] } }),
              post: table(
                {
                  id: col('pg/int4', 'pg/int4@1'),
                  author_id: col('pg/int4', 'pg/int4@1'),
                  editor_id: col('pg/int4', 'pg/int4@1'),
                },
                {
                  ...constraints,
                  fks: [fk('post', ['author_id'], 'user', ['id'], { index: foreignKeyIndex })],
                },
              ),
            },
          },
        },
      },
    },
  }).storage;
}

const coordinate = `Namespace "${UNBOUND_NAMESPACE_ID}" table "post": foreign key on columns [author_id]`;

describe('what backs a stored foreign key', () => {
  it.each([
    [
      'an index of its table, by name',
      { indexes: [index('post_author_idx', ['author_id'])] },
      { name: 'post_author_idx' },
    ],
    ['the primary key on its columns', { pk: { columns: ['author_id'] } }, { primaryKey: true }],
    ['a unique constraint on its columns', { uniques: [unique('author_id')] }, { unique: true }],
  ] as const)('may be %s', (_label, constraints, foreignKeyIndex) => {
    expect(validateStorageSemantics(postStorage(constraints, foreignKeyIndex))).toEqual([]);
  });

  it.each([
    [
      'an index its table does not have',
      { pk: { columns: ['id'] }, indexes: [index('post_author_idx', ['author_id'])] },
      { name: 'post_author_gone' },
      `${coordinate} is indexed by "post_author_gone", but the table has no index with that name`,
    ],
    [
      'a primary key on other columns',
      { pk: { columns: ['id'] } },
      { primaryKey: true },
      `${coordinate} is indexed by the primary key, but the table has no primary key on exactly those columns`,
    ],
    [
      'a unique constraint on other columns',
      { uniques: [unique('editor_id'), unique('author_id', 'editor_id')] },
      { unique: true },
      `${coordinate} is indexed by a unique constraint, but the table has no unique constraint on exactly those columns`,
    ],
  ] as const)('may not be %s', (_label, constraints, foreignKeyIndex, error) => {
    expect(validateStorageSemantics(postStorage(constraints, foreignKeyIndex))).toEqual([error]);
  });
});

describe('the index field of a stored foreign key', () => {
  const stored = {
    source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['author_id'] },
    target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
    index: { name: 'post_author_id_idx_f3862461' },
  };

  it('is kept on the IR node', () => {
    expect(ForeignKey.from(stored)).toEqual({
      source: stored.source,
      target: stored.target,
      index: { name: 'post_author_id_idx_f3862461' },
    });
  });

  it.each([{ name: 'post_author_id_idx_f3862461' }, { primaryKey: true }, { unique: true }])(
    'accepts %j',
    (foreignKeyIndex) => {
      expect(ForeignKeySchema({ ...stored, index: foreignKeyIndex })).not.toBeInstanceOf(
        type.errors,
      );
    },
  );

  it.each([
    { name: true },
    { primaryKey: false },
    { unique: 'post_author_key' },
    { name: 'post_author_id_idx_f3862461', unique: true },
    {},
  ])('refuses %j', (foreignKeyIndex) => {
    expect(ForeignKeySchema({ ...stored, index: foreignKeyIndex })).toBeInstanceOf(type.errors);
  });
});
