import { PrimaryKey, SqlForeignKeyIR, SqlUniqueIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { tableConstraintsFromNode } from '../../src/core/migrations/column-ddl-rendering';
import { checkConstraint, expectedColumn, table } from './node-issue-helpers';

describe('tableConstraintsFromNode — checks', () => {
  it('throws CONTRACT.CONSTRAINT_INVALID when the table node carries a check', () => {
    const orderTable = table({
      name: 'order',
      columns: {
        total: expectedColumn({ name: 'total', nativeType: 'NUMERIC', nullable: false }),
      },
      checks: [checkConstraint({ name: 'order_total_positive', expression: 'total > 0' })],
    });

    expect(() => tableConstraintsFromNode(orderTable, false)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CONSTRAINT_INVALID',
        meta: { constraintName: 'order_total_positive', tableName: 'order' },
      }),
    );
  });

  it('reports the first check when the table node carries more than one', () => {
    const orderTable = table({
      name: 'order',
      columns: {
        total: expectedColumn({ name: 'total', nativeType: 'NUMERIC', nullable: false }),
      },
      checks: [
        checkConstraint({ name: 'order_total_positive', expression: 'total > 0' }),
        checkConstraint({ name: 'order_total_capped', expression: 'total < 1000000' }),
      ],
    });

    expect(() => tableConstraintsFromNode(orderTable, false)).toThrow(
      expect.objectContaining({
        meta: { constraintName: 'order_total_positive', tableName: 'order' },
      }),
    );
  });

  it('renders PK / unique / FK constraints normally when the table node carries no checks', () => {
    const orderTable = table({
      name: 'order',
      columns: {
        id: expectedColumn({ name: 'id', nativeType: 'INTEGER', nullable: false }),
        email: expectedColumn({ name: 'email', nativeType: 'TEXT', nullable: false }),
        total: expectedColumn({ name: 'total', nativeType: 'NUMERIC', nullable: false }),
      },
      primaryKey: new PrimaryKey({ columns: ['id'] }),
      uniques: [new SqlUniqueIR({ columns: ['email'] })],
      foreignKeys: [
        new SqlForeignKeyIR({
          columns: ['id'],
          referencedTable: 'customer',
          referencedColumns: ['id'],
        }),
      ],
    });

    const constraints = tableConstraintsFromNode(orderTable, false);

    expect(constraints.map((c) => c.constructor.name)).toEqual([
      'PrimaryKeyConstraint',
      'UniqueConstraint',
      'ForeignKeyConstraint',
    ]);
  });
});
