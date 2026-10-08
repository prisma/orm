import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { col, fk, index, table } from '../src/factories';
import { ForeignKey } from '../src/ir/foreign-key';
import { ForeignKeySchema } from '../src/ir/storage-entry-schemas';
import { UniqueConstraint } from '../src/ir/unique-constraint';
import type { SqlStorage } from '../src/types';
import { validateStorageSemantics } from '../src/validators';

function postStorage(
  constraints: Omit<NonNullable<Parameters<typeof table>[1]>, 'fks'>,
  foreignKeyIndex: string,
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
                { id: col('pg/int4', 'pg/int4@1'), author_id: col('pg/int4', 'pg/int4@1') },
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

describe("a foreign key's index", () => {
  it.each([
    ['an index', { indexes: [index('post_author_idx', ['author_id'])] }],
    [
      'a unique constraint',
      { uniques: [new UniqueConstraint({ columns: ['author_id'], name: 'post_author_idx' })] },
    ],
    ['the primary key', { pk: { columns: ['author_id'], name: 'post_author_idx' } }],
  ])('may name %s of its table', (_label, constraints) => {
    expect(validateStorageSemantics(postStorage(constraints, 'post_author_idx'))).toEqual([]);
  });

  it('may not name what its table does not have', () => {
    expect(
      validateStorageSemantics(
        postStorage(
          {
            pk: { columns: ['id'] },
            indexes: [index('post_author_idx', ['author_id'])],
          },
          'post_author_gone',
        ),
      ),
    ).toEqual([
      `Namespace "${UNBOUND_NAMESPACE_ID}" table "post": foreign key on columns [author_id] names index "post_author_gone", but the table has no index, unique constraint or primary key with that name`,
    ]);
  });
});

describe('the index field of a stored foreign key', () => {
  const stored = {
    source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'post', columns: ['author_id'] },
    target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
    index: 'post_author_id_idx_f3862461',
  };

  it('is kept on the IR node', () => {
    expect(ForeignKey.from(stored)).toEqual({
      source: stored.source,
      target: stored.target,
      index: 'post_author_id_idx_f3862461',
    });
  });

  it('is a string', () => {
    expect(ForeignKeySchema(stored)).not.toBeInstanceOf(type.errors);
    expect(ForeignKeySchema({ ...stored, index: true })).toBeInstanceOf(type.errors);
  });
});
