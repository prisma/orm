import { col, lit } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import {
  AddColumnCall,
  CreateTableCall,
  columnNameOfCall,
  DropColumnCall,
  SetDefaultCall,
} from '../../src/core/migrations/op-factory-call';

describe('columnNameOfCall', () => {
  it('names the column a call acts on, whether the call carries the name or the column', () => {
    expect({
      setDefault: columnNameOfCall(
        new SetDefaultCall('public', 'user', col('role', 'text', { default: lit('member') })),
      ),
      addColumn: columnNameOfCall(new AddColumnCall('public', 'user', col('email', 'text'))),
      dropColumn: columnNameOfCall(new DropColumnCall('public', 'user', 'legacy')),
      createTable: columnNameOfCall(new CreateTableCall('public', 'user', [col('id', 'int4')])),
    }).toEqual({
      setDefault: 'role',
      addColumn: 'email',
      dropColumn: 'legacy',
      createTable: undefined,
    });
  });
});
