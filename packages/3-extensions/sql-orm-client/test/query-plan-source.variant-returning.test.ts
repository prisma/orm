import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../src/collection-tables';
import { variantReturning } from '../src/query-plan-source';
import { createTableScope } from '../src/table-scope';
import { buildMixedPolyContract } from './helpers';

const contract = buildMixedPolyContract();
const tables = createCollectionTables(contract, 'public', 'Task');

describe('variantReturning', () => {
  it('labels each mapped column of the variant table as a read does, leaving out the key columns', () => {
    const variantTable = tables.variants.get('feature');
    if (variantTable === undefined) {
      throw new Error('the fixture has an MTI variant feature');
    }

    const returning = variantReturning(contract, variantTable, 'Feature', ['id']);

    expect(
      returning.map((item) => ({ alias: item.alias, expr: item.expr, codec: item.codec?.codecId })),
    ).toEqual([
      {
        alias: 'features__priority',
        expr: expect.objectContaining({ table: 'features', column: 'priority' }),
        codec: 'pg/int4@1',
      },
      {
        alias: 'features__assignee_id',
        expr: expect.objectContaining({ table: 'features', column: 'assignee_id' }),
        codec: 'pg/int4@1',
      },
    ]);
  });

  it('labels and reads the columns through the alias of the variant table', () => {
    const scope = createTableScope();
    scope.alias('features');
    const variantTable = scope.aliasTable({ namespaceId: 'public', tableName: 'features' });

    const returning = variantReturning(contract, variantTable, 'Feature', ['id']);

    expect(returning.map((item) => ({ alias: item.alias, expr: item.expr }))).toEqual([
      {
        alias: 'features_2__priority',
        expr: expect.objectContaining({ table: 'features_2', column: 'priority' }),
      },
      {
        alias: 'features_2__assignee_id',
        expr: expect.objectContaining({ table: 'features_2', column: 'assignee_id' }),
      },
    ]);
  });
});
