import { describe, expect, it } from 'vitest';
import { field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { defineTestContract } from './helpers/define-test-contract';
import { unboundTables } from './unbound-tables';

const textColumn = columnDescriptor('sql/text@1');

describe('.defaultSql() (deprecated, removed in 8.0.0)', () => {
  it('still lowers its expression as a function default', () => {
    const contract = defineTestContract({
      models: {
        T: model('T', { fields: { id: field.column(textColumn).defaultSql('now()').id() } }),
      },
    });
    expect(unboundTables(contract.storage)['T']?.columns['id']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });
});
