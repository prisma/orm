import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

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
  rowsBySchema: Record<string, readonly string[]>,
): SqlControlDriverInstance<'postgres'> {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
      const schema = typeof params?.[0] === 'string' ? params[0] : 'public';
      const tables = rowsBySchema[schema] ?? [];
      let rows: ReadonlyArray<Record<string, unknown>> = [];
      if (sql.includes('information_schema.tables')) {
        rows = tables.map((name) => ({ table_name: name }));
      } else if (sql.includes('information_schema.columns')) {
        rows = tables.map((name) => column(name, 'id'));
      } else if (sql.includes('current_schema()')) {
        rows = [{ current_schema: 'public' }];
      } else if (sql.includes('version()')) {
        rows = [{ version: 'PostgreSQL 16.1' }];
      }
      return { rows: rows as unknown as Row[] };
    },
    close: async () => {},
  };
}

function contractDeclaringTables(tablesByNamespace: Record<string, readonly string[]>): unknown {
  return {
    storage: {
      namespaces: Object.fromEntries(
        Object.entries(tablesByNamespace).map(([namespaceId, tables]) => [
          namespaceId,
          { entries: { table: Object.fromEntries(tables.map((name) => [name, {}])) } },
        ]),
      ),
    },
  };
}

const adapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

describe('PostgresControlAdapter introspection of migration tool tables', () => {
  it('leaves out _prisma_migrations when no contract is given', async () => {
    const result = await adapter.introspect(
      driverWithTables({ public: ['_prisma_migrations', 'user'] }),
    );

    expect(Object.keys(result.namespaces['public']?.tables ?? {})).toEqual(['user']);
  });

  it('leaves out _prisma_migrations when the contract does not declare it', async () => {
    const result = await adapter.introspect(
      driverWithTables({ public: ['_prisma_migrations', 'user'] }),
      contractDeclaringTables({ public: ['user'] }),
    );

    expect(Object.keys(result.namespaces['public']?.tables ?? {})).toEqual(['user']);
  });

  it('keeps _prisma_migrations in the namespace whose contract declares it', async () => {
    const result = await adapter.introspect(
      driverWithTables({
        public: ['_prisma_migrations', 'user'],
        audit: ['_prisma_migrations'],
      }),
      contractDeclaringTables({ public: ['_prisma_migrations', 'user'], audit: [] }),
    );

    expect({
      public: Object.keys(result.namespaces['public']?.tables ?? {}),
      audit: Object.keys(result.namespaces['audit']?.tables ?? {}),
    }).toEqual({ public: ['_prisma_migrations', 'user'], audit: [] });
  });

  it('keeps _prisma_migrations declared in the unbound namespace that resolves to the same schema', async () => {
    const result = await adapter.introspect(
      driverWithTables({ public: ['_prisma_migrations', 'user'] }),
      contractDeclaringTables({ [UNBOUND_NAMESPACE_ID]: ['_prisma_migrations'], public: ['user'] }),
    );

    expect(Object.keys(result.namespaces)).toEqual(['public']);
    expect(Object.keys(result.namespaces['public']?.tables ?? {})).toEqual([
      '_prisma_migrations',
      'user',
    ]);
  });
});
