import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from './helpers/test-control-adapter';

function column(tableName: string, columnName: string): Record<string, unknown> {
  return {
    table_name: tableName,
    column_name: columnName,
    data_type: 'integer',
    udt_name: 'int4',
    is_nullable: 'NO',
    character_maximum_length: null,
    numeric_precision: 32,
    numeric_scale: 0,
    column_default: null,
    formatted_type: 'integer',
    attidentity: '',
  };
}

function driverWithTables(
  schemaName: string,
  tables: readonly string[],
  columns: readonly string[],
): SqlControlDriverInstance<'postgres'> {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string) => {
      let rows: ReadonlyArray<Record<string, unknown>> = [];
      if (sql.includes('information_schema.tables')) {
        rows = tables.map((name) => ({ table_name: name }));
      } else if (sql.includes('information_schema.columns')) {
        rows = tables.flatMap((name) => columns.map((columnName) => column(name, columnName)));
      } else if (sql.includes('current_schema()')) {
        rows = [{ current_schema: schemaName }];
      } else if (sql.includes('version()')) {
        rows = [{ version: 'PostgreSQL 16.1' }];
      }
      return { rows: rows as unknown as Row[] };
    },
    close: async () => {},
  };
}

const adapter = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

function ownKeys(record: object | undefined): unknown {
  return {
    prototypeIsPlain: Object.getPrototypeOf(record) === Object.prototype,
    keys: Object.keys(record ?? {}),
  };
}

describe('Postgres introspection of names every object has as a property', () => {
  it('keeps a schema, tables and columns named __proto__ and constructor as own keys', async () => {
    const result = await adapter.introspect(
      driverWithTables('__proto__', ['__proto__', 'constructor'], ['id', '__proto__']),
      undefined,
      '__proto__',
    );
    const namespace = Object.getOwnPropertyDescriptor(result.namespaces, '__proto__')?.value as
      | { tables: Record<string, { columns: object }> }
      | undefined;
    const protoTable = Object.getOwnPropertyDescriptor(namespace?.tables ?? {}, '__proto__')
      ?.value as { columns: object } | undefined;
    expect({
      namespaces: ownKeys(result.namespaces),
      tables: ownKeys(namespace?.tables),
      columns: ownKeys(protoTable?.columns),
    }).toEqual({
      namespaces: { prototypeIsPlain: true, keys: ['__proto__'] },
      tables: { prototypeIsPlain: true, keys: ['__proto__', 'constructor'] },
      columns: { prototypeIsPlain: true, keys: ['id', '__proto__'] },
    });
  });
});
