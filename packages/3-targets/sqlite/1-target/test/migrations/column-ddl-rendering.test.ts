import type { JsonValue } from '@internal/contract/types';
import type { DataType } from '@internal/framework-components/codec';
import { sqlDataType, sqlRawDataType } from '@internal/sql-contract/data-type';
import {
  PrimaryKey,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { sqliteCharacter, sqliteText } from '../../src/core/data-types';
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
        total: expectedColumn({ name: 'total', typeText: 'NUMERIC', nullable: false }),
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
        total: expectedColumn({ name: 'total', typeText: 'NUMERIC', nullable: false }),
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
        id: expectedColumn({ name: 'id', typeText: 'INTEGER', nullable: false }),
        email: expectedColumn({ name: 'email', typeText: 'TEXT', nullable: false }),
        total: expectedColumn({ name: 'total', typeText: 'NUMERIC', nullable: false }),
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

function column(storedType: DataType, codecId: string, typeParams?: Record<string, JsonValue>) {
  return new SqlColumnIR({
    name: 'c',
    typeText: 'text',
    nullable: false,
    storedType,
    storedTypeParams: {},
    codecRef: { codecId, ...(typeParams === undefined ? {} : { typeParams }) },
  });
}

describe('the type SQLite DDL writes for a column node', () => {
  it('is the name of the type the column is stored as, in upper case', () => {
    const datetime = column(sqliteText, 'sqlite/datetime@1');
    const character = column(sqliteCharacter, 'sql/char@1', { length: 10 });
    expect({
      spec: columnSpecFromNode(datetime, false).typeSql,
      ddl: ddlColumnFromNode(datetime, false).type,
      character: columnSpecFromNode(character, false).typeSql,
    }).toEqual({ spec: 'TEXT', ddl: 'TEXT', character: 'CHARACTER' });
  });

  it('is the name as given for a type whose name is its catalog text, which verify compares exactly', () => {
    const verbatim = sqlDataType<{ name: string }>('t/verbatim', {
      read: (json) => json,
      params: type({ name: 'string' }),
      nameIsCatalogText: true,
      render: ({ name }) => name,
    });
    expect({
      raw: columnSpecFromNode(column(sqlRawDataType, 'sql/raw@1', { sql: 'circle' }), false)
        .typeSql,
      other: ddlColumnFromNode(column(verbatim, 't/verbatim@1', { name: 'MyType(3)' }), false).type,
    }).toEqual({ raw: 'circle', other: 'MyType(3)' });
  });

  it('refuses a column with no data type', () => {
    const untyped = new SqlColumnIR({
      name: 'c',
      typeText: 'text',
      nullable: false,
      codecRef: { codecId: 'sqlite/text@1' },
    });
    expect(() => columnSpecFromNode(untyped, false)).toThrow(/column "c" has no data type/);
  });
});
