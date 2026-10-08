import { parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat } from './fixtures';

function schemaWithIndexOnForeignKey(index: {
  readonly type: string | undefined;
  readonly where: string | undefined;
  readonly columns?: readonly string[];
}): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      user: {
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
      post: {
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
            naming: parseNaming('post_user_id_live', undefined),
            columns: index.columns ?? ['user_id'],
            where: index.where,
            unique: false,
            partial: index.where !== undefined,
            type: index.type,
            options: undefined,
            annotations: undefined,
            dependsOn: undefined,
          },
        ],
      },
    },
  });
}

const relationLine = (psl: string) => psl.split('\n').find((line) => line.includes('@relation'));

describe('contract infer and the backing index of a foreign key', () => {
  it.each([
    ['no access method', undefined],
    ['btree', 'btree'],
  ])('leaves index unset beside a live index with %s', (_label, type) => {
    expect(
      relationLine(printPslFromFlat(schemaWithIndexOnForeignKey({ type, where: undefined }))),
    ).not.toContain('index:');
  });

  it.each([
    ['a hash index', { type: 'hash', where: undefined }],
    ['a gin index', { type: 'gin', where: undefined }],
    ['a partial index', { type: undefined, where: '(id > 0)' }],
  ])('writes index: false beside %s, the only index on the columns', (_label, index) => {
    expect(relationLine(printPslFromFlat(schemaWithIndexOnForeignKey(index)))).toContain(
      'index: false',
    );
  });

  it('names a live index whose first columns are the foreign key columns', () => {
    expect(
      relationLine(
        printPslFromFlat(
          schemaWithIndexOnForeignKey({
            type: undefined,
            where: undefined,
            columns: ['user_id', 'id'],
          }),
        ),
      ),
    ).toContain('index: "post_user_id_live"');
  });
});
