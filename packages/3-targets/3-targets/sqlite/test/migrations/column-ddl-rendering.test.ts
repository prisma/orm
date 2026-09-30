import {
  PrimaryKey,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { SQLITE_DATETIME_CODEC_ID } from '../../src/core/codec-ids';
import { sqliteDatetime } from '../../src/core/data-types';
import {
  columnSpecFromNode,
  ddlColumnFromNode,
  tableConstraintsFromNode,
} from '../../src/core/migrations/column-ddl-rendering';
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

describe('a contract default its data type does not hold', () => {
  const column = new SqlColumnIR({
    name: 'at',
    nativeType: 'text',
    nullable: false,
    resolvedDefault: { kind: 'literal', value: '2024-01-01T00:00:00.123456Z' },
    codecRef: { codecId: SQLITE_DATETIME_CODEC_ID },
    codecBaseNativeType: 'text',
    dataType: sqliteDatetime,
  });
  const refusal = expect.objectContaining({
    code: 'CONTRACT.DEFAULT_INVALID',
    message:
      'Column "at": The contract holds this default in a form its data type does not store: "2024-01-01T00:00:00.123456Z" has 6 digits after the decimal point, but sqlite/datetime holds milliseconds, so at most 3. Round it, as in "2024-01-01T12:34:56.123Z". Re-emit the contract, then try again.',
  });

  it('is refused rather than written, by both DDL paths', () => {
    expect(() => ddlColumnFromNode(column, false)).toThrow(refusal);
    expect(() => columnSpecFromNode(column, false)).toThrow(refusal);
  });
});
