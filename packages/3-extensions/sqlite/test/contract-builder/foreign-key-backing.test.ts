/**
 * SQLite registers no index types and refuses partial indexes, so every
 * declared index over a foreign key's columns backs the foreign key, as
 * before.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel } from '../../src/exports/contract-builder';

const integerColumn = { codecId: 'sqlite/integer@1', nativeType: 'integer' } as const;

function postIndexesBeside(declared: IndexConstraint | undefined) {
  const Author = model('Author', { fields: { id: field.column(integerColumn).id() } }).sql({
    table: 'author',
  });
  const Post = model('Post', {
    fields: { id: field.column(integerColumn).id(), authorId: field.column(integerColumn) },
    relations: {
      author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }).sql({ fk: { index: true } }),
    },
  }).sql({ table: 'post', indexes: declared === undefined ? [] : [declared] });
  const contract = defineContract({ models: { Author, Post } });
  const namespace = blindCast<
    { readonly table: Record<string, { readonly indexes: readonly Record<string, unknown>[] }> },
    'the SQLite namespace; only its tables are read here'
  >(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]);
  return namespace.table['post']!.indexes;
}

describe('a SQLite foreign key backing index', () => {
  it('is not derived beside a declared index on the foreign key column', () => {
    expect(postIndexesBeside({ kind: 'index', fields: ['authorId'], name: 'post_author' })).toEqual(
      [expect.objectContaining({ prefix: 'post_author' })],
    );
  });

  it('never meets a partial index, which SQLite refuses', () => {
    expect(() =>
      postIndexesBeside({
        kind: 'index',
        fields: ['authorId'],
        where: 'id > 0',
        name: 'post_author_live',
      }),
    ).toThrow(/does not support expression or partial indexes/);
  });

  it('is derived when the table has no index on the foreign key column', () => {
    expect(postIndexesBeside(undefined)).toEqual([
      expect.objectContaining({ prefix: 'post_authorId_idx', columns: ['authorId'] }),
    ]);
  });
});
