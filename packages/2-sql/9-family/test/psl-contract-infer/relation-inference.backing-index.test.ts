import { type SqlIndexIRInput, SqlTableIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferRelations } from '../../src/core/psl-contract-infer/relation-inference';

function liveIndex(overrides: Partial<SqlIndexIRInput>): SqlIndexIRInput {
  return {
    naming: { kind: 'exact', name: 'post_user_live' },
    columns: ['user_id'],
    where: undefined,
    unique: false,
    partial: false,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
    ...overrides,
  } as SqlIndexIRInput;
}

function relationIndexBeside(post: {
  readonly indexes?: readonly SqlIndexIRInput[];
  readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
  readonly primaryKey?: { readonly columns: readonly string[] };
}) {
  const tables = {
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
      primaryKey: post.primaryKey ?? { columns: ['id'] },
      foreignKeys: [{ columns: ['user_id'], referencedTable: 'user', referencedColumns: ['id'] }],
      uniques: post.uniques ?? [],
      indexes: post.indexes ?? [],
    }),
  };
  const { relationsByTable } = inferRelations(
    tables,
    new Map([
      ['user', 'User'],
      ['post', 'Post'],
    ]),
  );
  return relationsByTable.get('post')?.[0]?.index;
}

describe('the index argument contract infer writes on a relation', () => {
  it.each([
    ['a default index', { indexes: [liveIndex({})] }],
    ['a btree index', { indexes: [liveIndex({ type: 'btree' })] }],
    ['a unique constraint', { uniques: [{ columns: ['user_id'] }] }],
    ['the primary key', { primaryKey: { columns: ['user_id'] } }],
    ['a unique index', { indexes: [liveIndex({ unique: true })] }],
  ])('is absent beside %s on the foreign key columns', (_label, post) => {
    expect(relationIndexBeside(post)).toBeUndefined();
  });

  it.each([
    [
      'a plain index whose first columns are the foreign key columns',
      {
        indexes: [
          liveIndex({
            naming: { kind: 'exact', name: 'post_user_created' },
            columns: ['user_id', 'id'],
          }),
        ],
      },
      'post_user_created',
    ],
    [
      'a named unique constraint whose first columns are the foreign key columns',
      { uniques: [{ columns: ['user_id', 'id'], name: 'post_user_key' }] },
      'post_user_key',
    ],
  ])('names %s', (_label, post, name) => {
    expect(relationIndexBeside(post)).toBe(name);
  });

  it.each([
    ['no index', {}],
    ['a partial index', { indexes: [liveIndex({ where: 'id > 0', partial: true })] }],
    ['an index of a kind other than the default', { indexes: [liveIndex({ type: 'gin' })] }],
    [
      'a partial unique index',
      { indexes: [liveIndex({ unique: true, where: 'id > 0', partial: true })] },
    ],
    ['an index with options', { indexes: [liveIndex({ options: { fillfactor: '70' } })] }],
  ])('is false beside %s on the foreign key columns', (_label, post) => {
    expect(relationIndexBeside(post)).toBe(false);
  });
});
