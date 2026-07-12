import { describe, expect, it } from 'vitest';
import { INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE } from '../src/internal-temp-table-source';
import { createCollection } from './collection-fixtures';

describe('Collection internal temp-table query source bridge', () => {
  it('returns a select AST and row fields for the selected ORM columns', () => {
    const { collection } = createCollection();

    const subquery = collection.select('id', 'email')[INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE]();
    const ast = subquery.buildAst();

    expect(ast.kind).toBe('select');
    expect(ast.projection.map((item) => item.alias)).toEqual(['id', 'email']);
    expect(subquery.getRowFields()).toEqual({
      id: { codecId: 'pg/int4@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: false },
    });
  });

  it('uses the collection projection defaults when no select(...) was applied', () => {
    const { collection } = createCollection();

    const subquery = collection[INTERNAL_TO_TEMP_TABLE_QUERY_SOURCE]();
    const fields = subquery.getRowFields();

    expect(fields['id']).toEqual({ codecId: 'pg/int4@1', nullable: false });
    expect(fields['email']).toEqual({ codecId: 'pg/text@1', nullable: false });
  });
});
