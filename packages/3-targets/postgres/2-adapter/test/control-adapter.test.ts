import { CliStructuredError } from '@internal/errors/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import {
  PrimaryKey,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import type {
  PostgresDatabaseSchemaNode,
  PostgresTableSchemaNode,
} from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { parsePgNameArray, parsePgReloptions } from '../src/core/control-adapter';
import { createTestPostgresControlAdapter } from './helpers/test-control-adapter';

/**
 * These tests introspect a single schema, so the root holds exactly one
 * namespace node. This helper returns that namespace's tables, replacing the
 * old flat `result.tables` access.
 */
function tablesOf(
  result: PostgresDatabaseSchemaNode,
): Readonly<Record<string, PostgresTableSchemaNode>> {
  const namespaces = Object.values(result.namespaces);
  return namespaces[0]?.tables ?? {};
}

/** The sole introspected namespace's schema name. */
function schemaNameOf(result: PostgresDatabaseSchemaNode): string | undefined {
  return Object.values(result.namespaces)[0]?.schemaName;
}

type QueryHandler = {
  readonly match: (sql: string) => boolean;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
};

function includes(fragment: string): (sql: string) => boolean {
  return (sql) => sql.includes(fragment);
}

function createMockDriver(
  handlers: ReadonlyArray<QueryHandler>,
): SqlControlDriverInstance<'postgres'> {
  return {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string) => {
      const handler = handlers.find((entry) => entry.match(sql));
      return { rows: (handler?.rows ?? []) as unknown as Row[] };
    },
    close: async () => {},
  };
}

describe('PostgresControlAdapter', () => {
  it('names its signatures table', () => {
    const adapter = createTestPostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    );
    expect(adapter.markerLocation).toBe('_prisma.signatures');
  });

  describe('introspect', () => {
    it('introspects empty schema', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>() => ({ rows: [] as unknown as Row[] }),
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)).toEqual({});
      expect(schemaNameOf(result)).toBe('public');
      expect(result.serverVersionNumber).toBeUndefined();
      expect(result.existingSchemas).toEqual([]);
    });

    it('issues introspection queries sequentially on the single connection', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      let inFlight = 0;
      let maxInFlight = 0;
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await Promise.resolve();
          inFlight--;
          if (sql.includes('server_version_num')) {
            return { rows: [{ server_version_num: 150001 }] as unknown as Row[] };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      await adapter.introspect(mockDriver);

      expect(maxInFlight).toBe(1);
    });

    it('introspects schema with tables and columns', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      let _queryCallCount = 0;
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          _queryCallCount++;
          if (sql.includes('information_schema.tables')) {
            return {
              rows: [{ table_name: 'user' }] as unknown as Row[],
            };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  table_name: 'user',
                  column_name: 'email',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'NO',
                  character_maximum_length: 255,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return {
              rows: [
                {
                  table_name: 'user',
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)).toHaveProperty('user');
      expect(tablesOf(result)['user']?.columns).toHaveProperty('id');
      expect(tablesOf(result)['user']?.columns).toHaveProperty('email');
      expect(tablesOf(result)['user']?.columns['id']?.typeText).toBe('int4');
      expect(tablesOf(result)['user']?.columns['email']?.typeText).toBe('character varying(255)');
      expect(tablesOf(result)['user']?.columns['id']?.nullable).toBe(false);
      expect(tablesOf(result)['user']?.primaryKey).toEqual(
        new PrimaryKey({ columns: ['id'], name: 'user_pkey' }),
      );
    });

    it('handles character varying without length', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'text_col',
                  data_type: 'character varying',
                  udt_name: 'varchar',
                  is_nullable: 'YES',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['text_col']?.typeText).toBe('character varying');
    });

    it('handles numeric with precision and scale', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'price',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: 10,
                  numeric_scale: 2,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['price']?.typeText).toBe('numeric(10,2)');
    });

    it('handles numeric with precision only', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'amount',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: 10,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['amount']?.typeText).toBe('numeric(10)');
    });

    it('handles numeric without precision', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'value',
                  data_type: 'numeric',
                  udt_name: 'numeric',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['value']?.typeText).toBe('numeric');
    });

    it('maps json and jsonb columns to native types', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'event' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'event',
                  column_name: 'payload',
                  data_type: 'jsonb',
                  udt_name: 'jsonb',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  table_name: 'event',
                  column_name: 'raw',
                  data_type: 'json',
                  udt_name: 'json',
                  is_nullable: 'YES',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['event']?.columns['payload']?.typeText).toBe('jsonb');
      expect(tablesOf(result)['event']?.columns['raw']?.typeText).toBe('json');
    });

    it('uses formatted_type for bit length', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'flags',
              data_type: 'bit',
              udt_name: 'bit',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'bit(8)',
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['flags']?.typeText).toBe('bit(8)');
    });

    it('carries each type as format_type reports it', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'name',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'varchar(255)',
            },
            {
              table_name: 'user',
              column_name: 'code',
              data_type: 'character',
              udt_name: 'bpchar',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'bpchar(4)',
            },
            {
              table_name: 'user',
              column_name: 'flags',
              data_type: 'bit varying',
              udt_name: 'varbit',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'varbit(6)',
            },
            {
              table_name: 'user',
              column_name: 'seen_at',
              data_type: 'timestamp with time zone',
              udt_name: 'timestamptz',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'timestamp(3) with time zone',
            },
            {
              table_name: 'user',
              column_name: 'created_at',
              data_type: 'timestamp without time zone',
              udt_name: 'timestamp',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'timestamp(6) without time zone',
            },
            {
              table_name: 'user',
              column_name: 'local_time',
              data_type: 'time without time zone',
              udt_name: 'time',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'time(0) without time zone',
            },
            {
              table_name: 'user',
              column_name: 'zoned_time',
              data_type: 'time with time zone',
              udt_name: 'timetz',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'time(2) with time zone',
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.columns['name']?.typeText).toBe('varchar(255)');
      expect(tablesOf(result)['user']?.columns['code']?.typeText).toBe('bpchar(4)');
      expect(tablesOf(result)['user']?.columns['flags']?.typeText).toBe('varbit(6)');
      expect(tablesOf(result)['user']?.columns['seen_at']?.typeText).toBe(
        'timestamp(3) with time zone',
      );
      expect(tablesOf(result)['user']?.columns['created_at']?.typeText).toBe(
        'timestamp(6) without time zone',
      );
      expect(tablesOf(result)['user']?.columns['local_time']?.typeText).toBe(
        'time(0) without time zone',
      );
      expect(tablesOf(result)['user']?.columns['zoned_time']?.typeText).toBe(
        'time(2) with time zone',
      );
    });

    it('handles foreign keys', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'post' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'post',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'post',
              column_name: 'user_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [
            {
              table_name: 'post',
              constraint_name: 'post_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        {
          match: includes("contype = 'f'"),
          rows: [
            {
              table_name: 'post',
              constraint_name: 'post_user_id_fkey',
              column_name: 'user_id',
              ordinal_position: 1,
              referenced_table_schema: 'public',
              referenced_table_name: 'user',
              referenced_column_name: 'id',
              delete_rule: 'NO ACTION',
              update_rule: 'NO ACTION',
            },
          ],
        },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['post']?.foreignKeys).toEqual([
        new SqlForeignKeyIR({
          columns: ['user_id'],
          referencedTable: 'user',
          referencedSchema: 'public',
          referencedColumns: ['id'],
          name: 'post_user_id_fkey',
        }),
      ]);
      expect(tablesOf(result)['post']?.foreignKeys[0]?.dependsOn).toEqual([
        [
          { nodeKind: 'postgres-database', id: 'database' },
          { nodeKind: 'postgres-namespace', id: 'public' },
          { nodeKind: 'postgres-table', id: 'user' },
        ],
        [
          { nodeKind: 'postgres-database', id: 'database' },
          { nodeKind: 'postgres-namespace', id: 'public' },
          { nodeKind: 'postgres-table', id: 'post' },
          { nodeKind: 'sql-column', id: 'column:user_id' },
        ],
      ]);
    });

    it('handles multi-column foreign keys', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'order' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'order',
              column_name: 'user_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'order',
              column_name: 'account_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [
            {
              table_name: 'order',
              constraint_name: 'order_pkey',
              column_name: 'user_id',
              ordinal_position: 1,
            },
          ],
        },
        {
          match: includes("contype = 'f'"),
          rows: [
            {
              table_name: 'order',
              constraint_name: 'order_account_fkey',
              column_name: 'user_id',
              ordinal_position: 1,
              referenced_table_schema: 'public',
              referenced_table_name: 'account',
              referenced_column_name: 'user_id',
              delete_rule: 'CASCADE',
              update_rule: 'NO ACTION',
            },
            {
              table_name: 'order',
              constraint_name: 'order_account_fkey',
              column_name: 'account_id',
              ordinal_position: 2,
              referenced_table_schema: 'public',
              referenced_table_name: 'account',
              referenced_column_name: 'id',
              delete_rule: 'CASCADE',
              update_rule: 'NO ACTION',
            },
          ],
        },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['order']?.foreignKeys).toEqual([
        new SqlForeignKeyIR({
          columns: ['user_id', 'account_id'],
          referencedTable: 'account',
          referencedSchema: 'public',
          referencedColumns: ['user_id', 'id'],
          name: 'order_account_fkey',
          onDelete: 'cascade',
        }),
      ]);
    });

    it('handles unique constraints', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes("contype = 'f'"), rows: [] },
        {
          match: (sql) => sql.includes("contype = 'u'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_email_key',
              column_name: 'email',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.uniques).toEqual([
        new SqlUniqueIR({ columns: ['email'], name: 'user_email_key' }),
      ]);
    });

    it('handles multi-column unique constraints', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'tenant_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [],
        },
        { match: includes("contype = 'f'"), rows: [] },
        {
          match: (sql) => sql.includes("contype = 'u'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_email_tenant_key',
              column_name: 'email',
              ordinal_position: 1,
            },
            {
              table_name: 'user',
              constraint_name: 'user_email_tenant_key',
              column_name: 'tenant_id',
              ordinal_position: 2,
            },
          ],
        },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.uniques).toEqual([
        new SqlUniqueIR({ columns: ['email', 'tenant_id'], name: 'user_email_tenant_key' }),
      ]);
    });

    it('handles indexes', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'name',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        {
          match: includes('pg_indexes'),
          rows: [
            {
              tablename: 'user',
              indexname: 'user_name_idx',
              indisunique: false,
              attname: 'name',
              index_position: 1,
            },
          ],
        },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.indexes).toEqual([
        new SqlIndexIR({
          naming: { kind: 'exact', name: 'user_name_idx' },
          columns: ['name'],
          where: undefined,
          unique: false,
          partial: false,
          type: undefined,
          options: undefined,
          annotations: undefined,
          dependsOn: undefined,
        }),
      ]);
    });

    it('handles multi-column indexes', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'email',
              data_type: 'character varying',
              udt_name: 'varchar',
              is_nullable: 'NO',
              character_maximum_length: 255,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'tenant_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [],
        },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        {
          match: includes('pg_indexes'),
          rows: [
            {
              tablename: 'user',
              indexname: 'user_email_tenant_idx',
              indisunique: false,
              attname: 'email',
              index_position: 1,
            },
            {
              tablename: 'user',
              indexname: 'user_email_tenant_idx',
              indisunique: false,
              attname: 'tenant_id',
              index_position: 2,
            },
          ],
        },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.indexes).toEqual([
        new SqlIndexIR({
          naming: { kind: 'exact', name: 'user_email_tenant_idx' },
          columns: ['email', 'tenant_id'],
          where: undefined,
          unique: false,
          partial: false,
          type: undefined,
          options: undefined,
          annotations: undefined,
          dependsOn: undefined,
        }),
      ]);
    });

    it('captures an index with a null-attname key as an expression node (whole element list)', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return {
              rows: [
                {
                  table_name: 'user',
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return {
              rows: [
                {
                  tablename: 'user',
                  indexname: 'user_idx',
                  indisunique: false,
                  where_predicate: '(id > 0)',
                  attname: null,
                  element_def: 'lower(email)',
                  index_position: 1,
                },
                {
                  tablename: 'user',
                  indexname: 'user_idx',
                  indisunique: false,
                  where_predicate: '(id > 0)',
                  attname: 'id',
                  element_def: 'id',
                  index_position: 2,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      // A key with `attname: null` is an expression element (attnum 0). The
      // whole index becomes an expression node: the entire element list —
      // real columns included — is carried as one opaque string of the
      // per-position `pg_get_indexdef` reprints, and `columns` is absent.
      // The partial-index predicate rides along as `where`.
      expect(tablesOf(result)['user']?.indexes).toEqual([
        new SqlIndexIR({
          naming: { kind: 'exact', name: 'user_idx' },
          expression: 'lower(email), id',
          where: '(id > 0)',
          unique: false,
          partial: true,
          type: undefined,
          options: undefined,
          annotations: undefined,
          dependsOn: undefined,
        }),
      ]);
    });

    it('preserves both siblings when a unique and a plain index share one column tuple', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
                {
                  table_name: 'user',
                  column_name: 'email',
                  data_type: 'text',
                  udt_name: 'text',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return {
              rows: [
                {
                  table_name: 'user',
                  constraint_name: 'user_pkey',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return {
              rows: [
                {
                  tablename: 'user',
                  indexname: 'user_email_unique_idx',
                  indisunique: true,
                  attname: 'email',
                  index_position: 1,
                },
                {
                  tablename: 'user',
                  indexname: 'user_email_plain_idx',
                  indisunique: false,
                  attname: 'email',
                  index_position: 1,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      // Postgres permits a unique index and a plain index coexisting on the
      // identical column list. Index nodes are name-identified (catalog
      // names are unique per schema), so both enter the tree as distinct
      // siblings — no dedup.
      const indexes = tablesOf(result)['user']?.indexes;
      expect(indexes).toHaveLength(2);
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'user_email_unique_idx',
            unique: true,
            columns: ['email'],
          }),
          expect.objectContaining({
            name: 'user_email_plain_idx',
            unique: false,
            columns: ['email'],
          }),
        ]),
      );
    });

    it('handles custom schema name', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            expect(sql).toContain('$1');
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver, undefined, 'custom_schema');

      expect(schemaNameOf(result)).toBe('custom_schema');
    });

    it(
      'reads no server version from a value that is not an integer',
      async () => {
        const adapter = createTestPostgresControlAdapter(
          createPostgresBuiltinCodecLookup(),
          createPostgresBuiltinDataTypeLookup(),
        );
        const mockDriver: SqlControlDriverInstance<'postgres'> = {
          familyId: 'sql',
          targetId: 'postgres',
          query: async <Row = Record<string, unknown>>(sql: string) => {
            if (sql.includes('information_schema.tables')) {
              return { rows: [] as unknown as Row[] };
            }
            if (sql.includes('pg_extension')) {
              return { rows: [] as unknown as Row[] };
            }
            if (sql.includes('server_version_num')) {
              return {
                rows: [{ server_version_num: '15.4' }] as unknown as Row[],
              };
            }
            return { rows: [] as unknown as Row[] };
          },
          close: async () => {},
        };

        const result = await adapter.introspect(mockDriver);

        expect(result.serverVersionNumber).toBeUndefined();
      },
      timeouts.databaseOperation,
    );

    it.each([150004, '150004'])(
      'reads the server version number the database reports as %j',
      async (reported) => {
        const adapter = createTestPostgresControlAdapter(
          createPostgresBuiltinCodecLookup(),
          createPostgresBuiltinDataTypeLookup(),
        );
        const mockDriver: SqlControlDriverInstance<'postgres'> = {
          familyId: 'sql',
          targetId: 'postgres',
          query: async <Row = Record<string, unknown>>(sql: string) => ({
            rows: (sql.includes('server_version_num')
              ? [{ server_version_num: reported }]
              : []) as unknown as Row[],
          }),
          close: async () => {},
        };

        const result = await adapter.introspect(mockDriver);

        expect(result.serverVersionNumber).toBe(150004);
      },
    );

    it('reads no server version when the database reports none', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return { rows: [] as unknown as Row[] };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(result.serverVersionNumber).toBeUndefined();
    });

    it('handles table without primary key', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.primaryKey).toBeUndefined();
    });

    it('handles primary key without constraint name', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('information_schema.tables')) {
            return { rows: [{ table_name: 'user' }] as unknown as Row[] };
          }
          if (sql.includes('information_schema.columns')) {
            return {
              rows: [
                {
                  table_name: 'user',
                  column_name: 'id',
                  data_type: 'integer',
                  udt_name: 'int4',
                  is_nullable: 'NO',
                  character_maximum_length: null,
                  numeric_precision: null,
                  numeric_scale: null,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'p'")) {
            return {
              rows: [
                {
                  table_name: 'user',
                  constraint_name: '',
                  column_name: 'id',
                  ordinal_position: 1,
                },
              ] as unknown as Row[],
            };
          }
          if (sql.includes("contype = 'f'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes("contype = 'u'")) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_indexes')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('pg_extension')) {
            return { rows: [] as unknown as Row[] };
          }
          if (sql.includes('server_version_num')) {
            return {
              rows: [{ server_version_num: 150001 }] as unknown as Row[],
            };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.primaryKey).toEqual(new PrimaryKey({ columns: ['id'] }));
      expect(tablesOf(result)['user']?.primaryKey?.name).toBeUndefined();
    });

    it('carries integer, float and bool types as format_type reports them', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'metrics' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'metrics',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'integer',
            },
            {
              table_name: 'metrics',
              column_name: 'small',
              data_type: 'smallint',
              udt_name: 'int2',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'smallint',
            },
            {
              table_name: 'metrics',
              column_name: 'big',
              data_type: 'bigint',
              udt_name: 'int8',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'bigint',
            },
            {
              table_name: 'metrics',
              column_name: 'real_col',
              data_type: 'real',
              udt_name: 'float4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'real',
            },
            {
              table_name: 'metrics',
              column_name: 'double_col',
              data_type: 'double precision',
              udt_name: 'float8',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'double precision',
            },
            {
              table_name: 'metrics',
              column_name: 'active',
              data_type: 'boolean',
              udt_name: 'bool',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'boolean',
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['metrics']?.columns['id']?.typeText).toBe('integer');
      expect(tablesOf(result)['metrics']?.columns['small']?.typeText).toBe('smallint');
      expect(tablesOf(result)['metrics']?.columns['big']?.typeText).toBe('bigint');
      expect(tablesOf(result)['metrics']?.columns['real_col']?.typeText).toBe('real');
      expect(tablesOf(result)['metrics']?.columns['double_col']?.typeText).toBe('double precision');
      expect(tablesOf(result)['metrics']?.columns['active']?.typeText).toBe('boolean');
    });

    it('sorts multi-column primary key by ordinal position and skips PK from uniques', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'tenant_id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'user',
              column_name: 'id',
              data_type: 'integer',
              udt_name: 'int4',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        {
          match: includes("contype = 'p'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'id',
              ordinal_position: 2,
            },
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'tenant_id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes("contype = 'f'"), rows: [] },
        {
          match: (sql) => sql.includes("contype = 'u'"),
          rows: [
            {
              table_name: 'user',
              constraint_name: 'user_pkey',
              column_name: 'tenant_id',
              ordinal_position: 1,
            },
          ],
        },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['user']?.primaryKey).toEqual(
        new PrimaryKey({ columns: ['tenant_id', 'id'], name: 'user_pkey' }),
      );
      expect(tablesOf(result)['user']?.uniques).toEqual([]);
    });

    it('carries the reported type and the parsed resolvedDefault on columns', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'doc' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'doc',
              column_name: 'status',
              data_type: 'text',
              udt_name: 'text',
              is_nullable: 'NO',
              column_default: "'draft'::text",
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'doc',
              column_name: 'created_at',
              data_type: 'timestamp with time zone',
              udt_name: 'timestamptz',
              is_nullable: 'NO',
              column_default: 'now()',
              formatted_type: 'timestamp with time zone',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
            {
              table_name: 'doc',
              column_name: 'tags',
              data_type: 'ARRAY',
              udt_name: '_text',
              is_nullable: 'YES',
              column_default: null,
              formatted_type: 'text[]',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);
      const columns = tablesOf(result)['doc']?.columns;

      expect(columns?.['status']?.default).toBe("'draft'::text");
      expect(columns?.['status']?.typeText).toBe('text');
      // With no contract there is no codec to read a literal with, so only the raw text stays.
      expect(columns?.['status']?.resolvedDefault).toBeUndefined();

      expect(columns?.['created_at']?.typeText).toBe('timestamp with time zone');
      expect(columns?.['created_at']?.resolvedDefault).toEqual({
        kind: 'function',
        expression: 'now()',
      });

      expect(columns?.['tags']?.many).toBe(true);
      expect(columns?.['tags']?.typeText).toBe('text');
      expect(columns?.['tags']?.resolvedDefault).toBeUndefined();
    });
  });

  describe('introspect - USER-DEFINED enum types', () => {
    it('carries a mixed-case enum name quoted, as format_type reports it', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'Organization' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'Organization',
              column_name: 'billingState',
              data_type: 'USER-DEFINED',
              udt_name: 'BillingState',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: '"BillingState"',
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      expect(tablesOf(result)['Organization']?.columns['billingState']?.typeText).toBe(
        '"BillingState"',
      );
    });

    it('preserves lowercase enum formatted_type (no quotes from format_type)', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const mockDriver = createMockDriver([
        { match: includes('information_schema.tables'), rows: [{ table_name: 'user' }] },
        {
          match: includes('information_schema.columns'),
          rows: [
            {
              table_name: 'user',
              column_name: 'role',
              data_type: 'USER-DEFINED',
              udt_name: 'role',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              formatted_type: 'role',
            },
          ],
        },
        { match: includes("contype = 'p'"), rows: [] },
        { match: includes("contype = 'f'"), rows: [] },
        { match: includes("contype = 'u'"), rows: [] },
        { match: includes('pg_indexes'), rows: [] },
        { match: includes('pg_extension'), rows: [] },
        { match: includes('server_version_num'), rows: [{ server_version_num: 150001 }] },
      ]);

      const result = await adapter.introspect(mockDriver);

      // Lowercase enum names are not quoted by format_type(), should pass through unchanged
      expect(tablesOf(result)['user']?.columns['role']?.typeText).toBe('role');
    });
  });

  describe('parsePgReloptions', () => {
    it('throws when a reloption entry has no "=" separator', () => {
      expect(() => parsePgReloptions('{no_eq_sign}', 'item_body_idx')).toThrow(
        /malformed reloption entry "no_eq_sign" on index "item_body_idx"/,
      );
    });

    it('parses well-formed key=value entries into a record', () => {
      expect(parsePgReloptions('{fillfactor=70,fastupdate=true}', 'item_body_idx')).toEqual({
        fillfactor: '70',
        fastupdate: 'true',
      });
    });

    it('returns undefined for a null or empty input', () => {
      expect(parsePgReloptions(null, 'item_body_idx')).toBeUndefined();
      expect(parsePgReloptions('{}', 'item_body_idx')).toBeUndefined();
    });

    it('rejects a native array input', () => {
      expect(() => parsePgReloptions(['fillfactor=70'], 'item_body_idx')).toThrow(
        'expected raw text for a Postgres array',
      );
    });
  });

  describe('parsePgNameArray', () => {
    it('rejects a real JS array input', () => {
      expect(() => parsePgNameArray(['a', 'b'])).toThrow('expected raw text for a Postgres array');
    });

    it('parses an unquoted array literal', () => {
      expect(parsePgNameArray('{draft,review,done}')).toEqual(['draft', 'review', 'done']);
    });

    it('returns empty for an empty literal, non-strings, and non-literals', () => {
      expect(parsePgNameArray('{}')).toEqual([]);
      expect(parsePgNameArray(42)).toEqual([]);
      expect(parsePgNameArray('not-a-literal')).toEqual([]);
    });

    it('parses a quoted element containing whitespace', () => {
      expect(parsePgNameArray('{"in progress",done}')).toEqual(['in progress', 'done']);
    });

    it('parses a quoted element containing a comma', () => {
      expect(parsePgNameArray('{"a,b",c}')).toEqual(['a,b', 'c']);
    });

    it('parses a quoted element containing an escaped double quote', () => {
      expect(parsePgNameArray('{"say \\"hi\\"",plain}')).toEqual(['say "hi"', 'plain']);
    });

    it('parses a quoted element containing an escaped backslash', () => {
      expect(parsePgNameArray('{"back\\\\slash"}')).toEqual(['back\\slash']);
    });

    it('parses a quoted element containing braces', () => {
      expect(parsePgNameArray('{"{curly}",other}')).toEqual(['{curly}', 'other']);
    });

    it('does not trim significant leading/trailing whitespace inside quotes', () => {
      expect(parsePgNameArray('{" padded "}')).toEqual([' padded ']);
    });

    it('rejects an unterminated quoted element', () => {
      expect(() => parsePgNameArray('{"unterminated}')).toThrow('array dimension not balanced');
    });
  });

  describe('readMarker', () => {
    const validSignatureRow = {
      core_hash: 'abc',
      profile_hash: 'def',
      signed_at: new Date('2024-01-01T00:00:00Z'),
      invariants: [] as const,
    };

    it('returns null when marker table is absent', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        { match: includes('"information_schema"."tables"'), rows: [] },
      ]);
      await expect(adapter.readMarker(driver, 'app')).resolves.toBeNull();
    });

    it('returns null when marker table exists but row is absent', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        {
          match: includes('"information_schema"."tables"'),
          rows: [{ table_schema: '_prisma' }],
        },
        { match: includes('"_prisma"."signatures"'), rows: [] },
      ]);
      await expect(adapter.readMarker(driver, 'app')).resolves.toBeNull();
    });

    it('rejects native array invariants with a structured marker error', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        {
          match: includes('"information_schema"."tables"'),
          rows: [{ table_schema: '_prisma' }],
        },
        {
          match: includes('"_prisma"."signatures"'),
          rows: [{ ...validSignatureRow, invariants: ['inv-1', 'inv-2'] }],
        },
      ]);

      await expect(adapter.readMarker(driver, 'app')).rejects.toSatisfy((err: unknown) => {
        expect(CliStructuredError.is(err)).toBe(true);
        const structured = err as CliStructuredError & { readonly cause?: unknown };
        const envelope = structured.toEnvelope();
        expect(envelope.code).toBe('CONTRACT.MARKER_ROW_CORRUPT');
        expect(envelope.why).toContain('Invalid contract marker row');
        expect(envelope.why).toContain('expected raw text for a Postgres array');
        expect(structured.cause).toBeInstanceOf(TypeError);
        expect((structured.cause as Error).message).toContain(
          'expected raw text for a Postgres array',
        );
        return true;
      });
    });

    it('reads when the row was signed as the record of when it was written, and records no meta', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        {
          match: includes('"information_schema"."tables"'),
          rows: [{ table_schema: '_prisma' }],
        },
        {
          match: includes('"_prisma"."signatures"'),
          rows: [{ ...validSignatureRow, invariants: '{inv-a}' }],
        },
      ]);

      await expect(adapter.readMarker(driver, 'app')).resolves.toEqual({
        storageHash: 'abc',
        profileHash: 'def',
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        appTag: null,
        meta: {},
        invariants: ['inv-a'],
      });
    });

    it('rejects SQL NULL invariants as a corrupt marker row', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        {
          match: includes('"information_schema"."tables"'),
          rows: [{ table_schema: '_prisma' }],
        },
        {
          match: includes('"_prisma"."signatures"'),
          rows: [{ ...validSignatureRow, invariants: null }],
        },
      ]);

      await expect(adapter.readMarker(driver, 'app')).rejects.toSatisfy((err: unknown) => {
        expect(CliStructuredError.is(err)).toBe(true);
        const structured = err as CliStructuredError & { readonly cause?: unknown };
        const envelope = structured.toEnvelope();
        expect(envelope).toMatchObject({
          code: 'CONTRACT.MARKER_ROW_CORRUPT',
          why: expect.stringContaining('Invalid contract marker row'),
          meta: { space: 'app' },
        });
        expect(envelope.why).toContain('expected raw text for a Postgres array, got object');
        expect(JSON.stringify(envelope)).toContain('_prisma.signatures');
        expect(structured.cause).toBeInstanceOf(TypeError);
        expect((structured.cause as Error).message).toContain(
          'expected raw text for a Postgres array, got object',
        );
        return true;
      });
    });

    it('throws CONTRACT.MARKER_READ_FAILED when marker read query fails', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string) => {
          if (sql.includes('"information_schema"."tables"')) {
            return { rows: [{ table_schema: '_prisma' }] as unknown as Row[] };
          }
          throw new Error('permission denied for table marker');
        },
        close: async () => {},
      };

      await expect(adapter.readMarker(driver, 'app')).rejects.toSatisfy((err: unknown) => {
        expect((err as unknown as CliStructuredError).toEnvelope().code).toBe(
          'CONTRACT.MARKER_READ_FAILED',
        );
        return true;
      });
    });
  });

  describe('readAllMarkers', () => {
    it('decodes invariants array text before marker validation', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        { match: includes('"information_schema"."tables"'), rows: [{ '?column?': 1 }] },
        {
          match: includes('"_prisma"."signatures"'),
          rows: [
            {
              space: 'app',
              core_hash: 'abc',
              profile_hash: 'def',
              signed_at: new Date('2024-01-01T00:00:00Z'),
              invariants: '{inv-a,inv-b}',
            },
          ],
        },
      ]);

      const result = await adapter.readAllMarkers(driver);
      expect(result.get('app')?.invariants).toEqual(['inv-a', 'inv-b']);
    });

    it('throws CONTRACT.MARKER_ROW_CORRUPT on first corrupt row', async () => {
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );
      const driver = createMockDriver([
        { match: includes('"information_schema"."tables"'), rows: [{ '?column?': 1 }] },
        {
          match: includes('"_prisma"."signatures"'),
          rows: [
            {
              space: 'app',
              core_hash: 'abc',
              profile_hash: 'def',
              signed_at: new Date('2024-01-01T00:00:00Z'),
              invariants: '{not-an-array',
            },
          ],
        },
      ]);

      await expect(adapter.readAllMarkers(driver)).rejects.toSatisfy((err: unknown) => {
        expect(CliStructuredError.is(err)).toBe(true);
        expect((err as unknown as CliStructuredError).toEnvelope().code).toBe(
          'CONTRACT.MARKER_ROW_CORRUPT',
        );
        return true;
      });
    });
  });

  describe('the policies in _prisma.config', () => {
    const policies = { change: ['migrate'], dataProtection: { dataLoss: 'data-loss-forbidden' } };

    function signatureRow(space: string, rowPolicies: unknown) {
      return {
        space,
        core_hash: 'abc',
        profile_hash: 'def',
        signed_at: new Date('2024-01-01T00:00:00Z'),
        invariants: '{}',
        policies: rowPolicies,
        config_row: rowPolicies === undefined ? null : true,
      };
    }

    function driverReturning(
      rows: ReadonlyArray<Record<string, unknown>>,
      options: { readonly configTable: boolean } = { configTable: true },
    ) {
      const signatureReads: string[] = [];
      const driver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
          if (sql.includes('pg_catalog.pg_attribute')) {
            const configColumns = options.configTable ? [{ column_name: 'policies' }] : [];
            return {
              rows: (params?.[1] === 'config' ? configColumns : []) as unknown as Row[],
            };
          }
          if (sql.includes('"information_schema"')) {
            return { rows: [{ table_schema: '_prisma' }] as unknown as Row[] };
          }
          if (sql.includes('"_prisma"."signatures"')) {
            signatureReads.push(sql);
            return { rows: rows as unknown as Row[] };
          }
          return { rows: [] as unknown as Row[] };
        },
        close: async () => {},
      };
      return { driver, signatureReads };
    }

    const adapter = createTestPostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    );

    it('come back as meta.policies on the application space, read in the same statement as its signature', async () => {
      const { driver, signatureReads } = driverReturning([signatureRow('app', policies)]);

      const record = await adapter.readMarker(driver, 'app');

      expect({ meta: record?.meta, joinsConfig: signatureReads[0] }).toEqual({
        meta: { policies },
        joinsConfig: expect.stringContaining('LEFT JOIN "_prisma"."config"'),
      });
    });

    it('come back as they are stored, for the framework to parse', async () => {
      const { driver } = driverReturning([signatureRow('app', 'strict')]);

      const result = await adapter.readMarkerDiscriminated(driver, 'app');

      expect(result).toMatchObject({ kind: 'present', record: { meta: { policies: 'strict' } } });
    });

    it('come back as null when they are stored as JSON null, for the framework to report as unreadable', async () => {
      const { driver } = driverReturning([signatureRow('app', null)]);

      await expect(adapter.readMarker(driver, 'app')).resolves.toMatchObject({
        meta: { policies: null },
      });
    });

    it('leave the application space with no meta when config has no row', async () => {
      const { driver } = driverReturning([signatureRow('app', undefined)]);

      await expect(adapter.readMarker(driver, 'app')).resolves.toMatchObject({ meta: {} });
    });

    it('leave the application space with no meta, and are not read, when there is no config table', async () => {
      const { driver, signatureReads } = driverReturning([signatureRow('app', undefined)], {
        configTable: false,
      });

      const record = await adapter.readMarker(driver, 'app');

      expect({ meta: record?.meta, reads: signatureReads }).toEqual({
        meta: {},
        reads: [expect.not.stringContaining('config')],
      });
    });

    it('are not carried by another space', async () => {
      const { driver } = driverReturning([signatureRow('extension', policies)]);

      await expect(adapter.readMarker(driver, 'extension')).resolves.toMatchObject({ meta: {} });
    });

    it('come back on the application space alone when every signature is read', async () => {
      const { driver, signatureReads } = driverReturning([
        signatureRow('app', policies),
        signatureRow('extension', policies),
      ]);

      const markers = await adapter.readAllMarkers(driver);

      expect({
        app: markers.get('app')?.meta,
        extension: markers.get('extension')?.meta,
        joinsConfig: signatureReads[0],
      }).toEqual({
        app: { policies },
        extension: {},
        joinsConfig: expect.stringContaining('LEFT JOIN "_prisma"."config"'),
      });
    });

    it('are not read by the check the SQL client makes on first use', async () => {
      const { driver, signatureReads } = driverReturning([signatureRow('app', policies)]);

      const result = await adapter.readSignatureDiscriminated(driver, 'app');

      expect({ result, reads: signatureReads }).toMatchObject({
        result: { kind: 'present', record: { meta: {} } },
        reads: [expect.not.stringContaining('config')],
      });
    });
  });

  describe("the Prisma space's own row", () => {
    const signatureColumns = ['space', 'core_hash', 'profile_hash', 'invariants'];

    function recordingDriver(configColumns: readonly string[]) {
      const statements: string[] = [];
      const driver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
          statements.push(sql);
          if (sql.includes('pg_catalog.pg_attribute')) {
            const columns = params?.[1] === 'config' ? configColumns : signatureColumns;
            return { rows: columns.map((column_name) => ({ column_name })) as unknown as Row[] };
          }
          if (sql.includes('pg_catalog.row_security_active')) {
            return { rows: [{ readable: true, filtered: false }] as unknown as Row[] };
          }
          if (sql.includes('"information_schema"')) {
            return { rows: [{ table_schema: '_prisma' }] as unknown as Row[] };
          }
          return {
            rows: [
              { space: '_prisma', core_hash: 'abc', profile_hash: 'def', invariants: '{}' },
            ] as unknown as Row[],
          };
        },
        close: async () => {},
      };
      return { driver, statements };
    }

    it('is read among every signature, when config has its policies column, through those columns and the policies alone', async () => {
      const { driver, statements } = recordingDriver(['id', 'policies']);
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );

      const all = await adapter.readAllMarkers(driver);

      expect({ all: all.get('_prisma')?.storageHash, statements }).toEqual({
        all: 'abc',
        statements: [
          expect.stringContaining('"information_schema"."tables"'),
          expect.stringContaining('pg_catalog.pg_attribute'),
          expect.stringContaining('pg_catalog.row_security_active'),
          'SELECT "signatures"."space" AS "space", "signatures"."core_hash" AS "core_hash", "signatures"."profile_hash" AS "profile_hash", "signatures"."invariants" AS "invariants", "config"."policies" AS "policies", "config"."policies" IS NOT NULL AS "config_row" FROM "_prisma"."signatures" LEFT JOIN "_prisma"."config" ON true',
        ],
      });
    });

    it('is read through the columns every release of Prisma 8 reads it through, and no others', async () => {
      const statements: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
      const driver: SqlControlDriverInstance<'postgres'> = {
        familyId: 'sql',
        targetId: 'postgres',
        query: async <Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) => {
          statements.push({ sql, params });
          if (sql.includes('pg_catalog.pg_attribute')) {
            return {
              rows: signatureColumns.map((column_name) => ({
                column_name,
              })) as unknown as Row[],
            };
          }
          if (sql.includes('"information_schema"')) {
            return { rows: [{ table_schema: '_prisma' }] as unknown as Row[] };
          }
          return {
            rows: [
              { space: '_prisma', core_hash: 'abc', profile_hash: 'def', invariants: '{}' },
            ] as unknown as Row[],
          };
        },
        close: async () => {},
      };
      const adapter = createTestPostgresControlAdapter(
        createPostgresBuiltinCodecLookup(),
        createPostgresBuiltinDataTypeLookup(),
      );

      const own = await adapter.readMarker(driver, '_prisma');
      const ownStatements = statements.splice(0);
      const all = await adapter.readAllMarkers(driver);
      const allStatements = statements.splice(0);

      expect({
        own: own?.storageHash,
        all: all.get('_prisma')?.storageHash,
        ownStatements: ownStatements.map(({ sql }) => sql),
        allStatements: allStatements.map(({ sql }) => sql),
      }).toEqual({
        own: 'abc',
        all: 'abc',
        ownStatements: [
          expect.stringContaining('"information_schema"."tables"'),
          expect.stringContaining('pg_catalog.pg_attribute'),
          'SELECT "signatures"."core_hash" AS "core_hash", "signatures"."profile_hash" AS "profile_hash", "signatures"."invariants" AS "invariants" FROM "_prisma"."signatures" WHERE "signatures"."space" = $1',
        ],
        allStatements: [
          expect.stringContaining('"information_schema"."tables"'),
          expect.stringContaining('pg_catalog.pg_attribute'),
          'SELECT "signatures"."space" AS "space", "signatures"."core_hash" AS "core_hash", "signatures"."profile_hash" AS "profile_hash", "signatures"."invariants" AS "invariants" FROM "_prisma"."signatures"',
        ],
      });
    });
  });
});
