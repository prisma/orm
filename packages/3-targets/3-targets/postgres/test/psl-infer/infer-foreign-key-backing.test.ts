/**
 * `contract infer` writes `index: false` on a relation whose foreign key no live index backs, so
 * that `contract emit` derives no backing index the database lacks. Which live indexes back a
 * foreign key comes from the index type registrations of the whole stack, the same registry
 * `contract emit` reads: the target's own types and those of every extension pack.
 */
import { defineIndexTypes, indexTypeRegistryOf } from '@internal/sql-contract/index-types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { postgresIndexTypes } from '../../src/core/index-types';
import { inferBuildContext, printPslFromFlat } from './fixtures';

function schemaWithIndexOnForeignKey(indexType: string): SqlSchemaIR {
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
            naming: parseNaming('post_user_id_idx', undefined),
            columns: ['user_id'],
            where: undefined,
            unique: false,
            partial: false,
            type: indexType,
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

describe('contract infer and foreign key backing', () => {
  it('stamps index: false when the live index is of a type that cannot back a foreign key', () => {
    expect(relationLine(printPslFromFlat(schemaWithIndexOnForeignKey('gist')))).toContain(
      'index: false',
    );
  });

  it('leaves index unset when the live index is of a type that can', () => {
    expect(relationLine(printPslFromFlat(schemaWithIndexOnForeignKey('hash')))).not.toContain(
      'index: false',
    );
  });

  it("reads an extension pack's registration, not only the target's", () => {
    const withPack = {
      ...inferBuildContext,
      indexTypes: indexTypeRegistryOf([
        { id: 'postgres', indexTypes: postgresIndexTypes },
        {
          id: 'ordered-pack',
          indexTypes: defineIndexTypes().add('ordered', {
            options: type('object'),
            backsForeignKey: true,
          }),
        },
      ]),
    };

    expect(relationLine(printPslFromFlat(schemaWithIndexOnForeignKey('ordered')))).toContain(
      'index: false',
    );
    expect(
      relationLine(printPslFromFlat(schemaWithIndexOnForeignKey('ordered'), withPack)),
    ).not.toContain('index: false');
  });
});
