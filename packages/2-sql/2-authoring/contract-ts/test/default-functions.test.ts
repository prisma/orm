import { describe, expect, it } from 'vitest';
import { field, model } from '../src/contract-builder';
import { autoincrement, now } from '../src/default-functions';
import { columnDescriptor } from './helpers/column-descriptor';
import { defineTestContract } from './helpers/define-test-contract';
import { unboundTables } from './unbound-tables';

const int4Column = columnDescriptor('pg/int4@1');

describe('named default functions', () => {
  it('now() is the storage default PSL writes as @default(now())', () => {
    expect(now()).toEqual({ kind: 'function', expression: 'now()' });
  });

  it('autoincrement() is the storage default PSL writes as @default(autoincrement())', () => {
    expect(autoincrement()).toEqual({ kind: 'function', expression: 'autoincrement()' });
  });

  it('both are accepted by .default() and lower to the column default', () => {
    const contract = defineTestContract({
      models: {
        T: model('T', {
          fields: {
            id: field.column(int4Column).default(autoincrement()).id(),
            at: field.column(int4Column).default(now()),
          },
        }),
      },
    });
    const columns = unboundTables(contract.storage)['T']?.columns;
    expect(columns?.['id']?.default).toEqual({ kind: 'function', expression: 'autoincrement()' });
    expect(columns?.['at']?.default).toEqual({ kind: 'function', expression: 'now()' });
  });
});
