/**
 * A foreign key gets a derived backing index unless an index of the table
 * already covers its columns in order. Only an index that can serve the
 * foreign key's lookups counts: one without a `where` predicate, whose type is
 * the default or a type the Postgres target declares able to back a foreign
 * key (btree, hash). A full-text, gin or partial index over the same column
 * does not.
 */
import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  fullTextIndex,
  model,
  rel,
} from '../../src/exports/contract-builder';

const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const authorId: ColumnRef<'authorId'> = { kind: 'columnRef', fieldName: 'authorId' };

function postIndexesBeside(declared: IndexConstraint | undefined) {
  const Author = model('Author', { fields: { id: field.column(textColumn).id() } }).sql({
    table: 'author',
  });
  const Post = model('Post', {
    fields: { id: field.column(textColumn).id(), authorId: field.column(textColumn) },
    relations: {
      author: rel.belongsTo(Author, { from: 'authorId', to: 'id' }).sql({ fk: { index: true } }),
    },
  }).sql({ table: 'post', indexes: declared === undefined ? [] : [declared] });
  const contract = defineContract({ models: { Author, Post } });
  const namespace = blindCast<
    { readonly table: Record<string, { readonly indexes: readonly Record<string, unknown>[] }> },
    'a Postgres namespace; only its tables are read here'
  >(contract.storage.namespaces['public']);
  return namespace.table['post']!.indexes;
}

const derivedBackingIndex = expect.objectContaining({
  prefix: 'post_authorId_idx',
  columns: ['authorId'],
});

const indexOnAuthorId = (method: Partial<IndexConstraint>): IndexConstraint =>
  blindCast<IndexConstraint, 'a field-tuple index over authorId'>({
    kind: 'index',
    fields: ['authorId'],
    name: 'post_author',
    ...method,
  });

describe('a foreign key backing index', () => {
  it('is derived when the table has no index on the foreign key columns', () => {
    expect(postIndexesBeside(undefined)).toEqual([derivedBackingIndex]);
  });

  it.each([
    ['a full-text index', fullTextIndex(authorId, { name: 'post_author_search' })],
    ['a gin index', indexOnAuthorId({ type: 'gin', options: {} })],
    ['a partial index', indexOnAuthorId({ where: "id <> ''" })],
  ])('is derived beside %s on the foreign key column', (_label, declared) => {
    expect(postIndexesBeside(declared)).toContainEqual(derivedBackingIndex);
  });

  it.each([
    ['an untyped index', indexOnAuthorId({})],
    ['a btree index', indexOnAuthorId({ type: 'btree', options: {} })],
    ['a hash index', indexOnAuthorId({ type: 'hash', options: {} })],
  ])('is not derived beside %s on the foreign key column', (_label, declared) => {
    expect(postIndexesBeside(declared)).toEqual([
      expect.objectContaining({ prefix: 'post_author' }),
    ]);
  });
});
