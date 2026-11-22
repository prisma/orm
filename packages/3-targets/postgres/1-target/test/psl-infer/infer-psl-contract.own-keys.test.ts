import { flatPslModels } from '@internal/framework-components/psl-ast';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { inferPslAstFromFlat } from './fixtures';

describe('contract infer of tables named like properties every object has', () => {
  it('infers a table named constructor, and leaves out a relation to a table named toString it did not read', async () => {
    const schema = new SqlSchemaIR({
      tables: {
        constructor: {
          name: 'constructor',
          columns: {
            id: { name: 'id', typeText: 'int4', nullable: false },
            ref_id: { name: 'ref_id', typeText: 'int4', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['ref_id'], referencedTable: 'toString', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });

    const models = flatPslModels(await inferPslAstFromFlat(schema));
    expect(
      models.map((model) => ({
        name: model.name,
        fields: model.fields.map((field) => field.name),
      })),
    ).toEqual([{ name: 'Constructor', fields: ['id', 'refId'] }]);
  });
});
