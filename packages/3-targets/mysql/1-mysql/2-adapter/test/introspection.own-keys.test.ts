import { mysqlDataTypes } from '@internal/target-mysql/data-types';
import { describe, expect, it } from 'vitest';
import {
  buildMysqlSchemaIR,
  type MysqlColumnRow,
  type ReadLiteralDefault,
} from '../src/core/migrations/introspection';

const column = (table_name: string, column_name: string, position: number): MysqlColumnRow => ({
  table_name,
  column_name,
  ordinal_position: String(position),
  column_default: null,
  is_nullable: 'NO',
  column_type: 'int',
  extra: '',
});

const readLiteral: ReadLiteralDefault = async () => ({});

function ownKeys(record: object | undefined): unknown {
  return {
    prototypeIsPlain: Object.getPrototypeOf(record) === Object.prototype,
    keys: Object.keys(record ?? {}),
  };
}

describe('MySQL introspection of names every object has as a property', () => {
  it('keeps tables and columns named __proto__ and constructor as own keys', async () => {
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['__proto__', 'constructor'],
        columns: [
          column('__proto__', 'id', 1),
          column('__proto__', '__proto__', 2),
          column('constructor', 'id', 1),
        ],
        indexes: [],
        constraints: [],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    const protoTable = Object.getOwnPropertyDescriptor(schema.tables, '__proto__')?.value as
      | { columns: object }
      | undefined;
    expect({
      tables: ownKeys(schema.tables),
      columns: ownKeys(protoTable?.columns),
    }).toEqual({
      tables: { prototypeIsPlain: true, keys: ['__proto__', 'constructor'] },
      columns: { prototypeIsPlain: true, keys: ['id', '__proto__'] },
    });
  });
});
