import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

const createMockDriver = (
  columns: Array<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    character_maximum_length: number | null;
    numeric_precision: number | null;
    numeric_scale: number | null;
    column_default: string | null;
  }>,
): SqlControlDriverInstance<'postgres'> => ({
  familyId: 'sql',
  targetId: 'postgres',
  query: async <Row = Record<string, unknown>>(sql: string) => {
    if (sql.includes('information_schema.tables')) {
      return { rows: [{ table_name: 'user' }] as Row[] };
    }
    if (sql.includes('information_schema.columns')) {
      // Add table_name to each column for batched query grouping
      return { rows: columns.map((col) => ({ ...col, table_name: 'user' })) as Row[] };
    }
    if (sql.includes("contype = 'p'")) {
      return { rows: [] as Row[] };
    }
    if (sql.includes("contype = 'f'")) {
      return { rows: [] as Row[] };
    }
    if (sql.includes("contype = 'u'")) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('pg_indexes')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('pg_extension')) {
      return { rows: [] as Row[] };
    }
    if (sql.includes('version()')) {
      return { rows: [{ version: 'PostgreSQL 15.1' }] as Row[] };
    }
    return { rows: [] as Row[] };
  },
  close: async () => {},
});

describe('PostgresControlAdapter column defaults', () => {
  it('stores raw default expressions from database', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const adapter = new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    );
    const mockDriver = createMockDriver([
      {
        column_name: 'id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "nextval('user_id_seq'::regclass)",
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'now()',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'CURRENT_TIMESTAMP',
      },
      {
        column_name: 'tracked_at',
        data_type: 'timestamp',
        udt_name: 'timestamp',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'clock_timestamp()',
      },
      {
        column_name: 'uuid',
        data_type: 'uuid',
        udt_name: 'uuid',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'gen_random_uuid()',
      },
      {
        column_name: 'active',
        data_type: 'boolean',
        udt_name: 'bool',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'true',
      },
      {
        column_name: 'disabled',
        data_type: 'boolean',
        udt_name: 'bool',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'false',
      },
      {
        column_name: 'count',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: '42',
      },
      {
        column_name: 'ratio',
        data_type: 'numeric',
        udt_name: 'numeric',
        is_nullable: 'NO',
        character_maximum_length: null,
        numeric_precision: 10,
        numeric_scale: 2,
        column_default: '3.14',
      },
      {
        column_name: 'name',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        character_maximum_length: 255,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "'Hello''s'::text",
      },
      {
        column_name: 'note',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: "'plain text'",
      },
      {
        column_name: 'fallback',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: 'uuid_generate_v4()',
      },
      {
        column_name: 'no_default',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        character_maximum_length: null,
        numeric_precision: null,
        numeric_scale: null,
        column_default: null,
      },
    ]);

    const result = await adapter.introspect(mockDriver);
    const columns = Object.values(result.namespaces)[0]?.tables['user']?.columns ?? {};

    // Defaults are stored as raw strings from the database
    expect(columns['id']).toMatchObject({
      default: "nextval('user_id_seq'::regclass)",
    });
    expect(columns['created_at']).toMatchObject({
      default: 'now()',
    });
    expect(columns['updated_at']).toMatchObject({
      default: 'CURRENT_TIMESTAMP',
    });
    expect(columns['tracked_at']).toMatchObject({
      default: 'clock_timestamp()',
    });
    expect(columns['uuid']).toMatchObject({
      default: 'gen_random_uuid()',
    });
    expect(columns['active']).toMatchObject({
      default: 'true',
    });
    expect(columns['disabled']).toMatchObject({
      default: 'false',
    });
    expect(columns['count']).toMatchObject({
      default: '42',
    });
    expect(columns['ratio']).toMatchObject({
      default: '3.14',
    });
    expect(columns['name']).toMatchObject({
      default: "'Hello''s'::text",
    });
    expect(columns['note']).toMatchObject({
      default: "'plain text'",
    });
    expect(columns['fallback']).toMatchObject({
      default: 'uuid_generate_v4()',
    });
    expect(columns['no_default']).not.toHaveProperty('default');
  });
});

describe('PostgresControlAdapter reads a literal default with the column codec', () => {
  const column = (
    name: string,
    udtName: string,
    columnDefault: string,
    precision: number | null = null,
    scale: number | null = null,
  ) => ({
    column_name: name,
    data_type: udtName,
    udt_name: udtName,
    is_nullable: 'NO',
    character_maximum_length: null,
    numeric_precision: precision,
    numeric_scale: scale,
    column_default: columnDefault,
  });
  const contract = {
    storage: {
      namespaces: {
        public: {
          entries: {
            table: {
              user: {
                columns: {
                  count: { codecId: 'pg/int4@1' },
                  ratio: { codecId: 'pg/numeric@1', typeParams: { precision: 10, scale: 2 } },
                  active: { codecId: 'pg/bool@1' },
                  meta: { codecId: 'pg/jsonb@1' },
                  bad: { codecId: 'pg/int4@1' },
                  created: { codecId: 'pg/timestamptz-temporal@1' },
                  blob: {
                    codecId: 'pg/bytea@1',
                    default: { kind: 'function', expression: "'hello'::bytea" },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  it('holds the value and the stored JSON of each default, and the value of a contract expression that writes a literal', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const adapter = new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    );
    const driver = createMockDriver([
      column('count', 'int4', '42'),
      column('ratio', 'numeric', '3.1', 10, 2),
      column('active', 'bool', 'true'),
      column('meta', 'jsonb', `'{"b": 1, "a": 2}'::jsonb`),
      column('bad', 'int4', "'x'::integer"),
      column('created', 'timestamptz', 'now()'),
      column('blob', 'bytea', "'\\x68656c6c6f'::bytea"),
    ]);

    const result = await adapter.introspect(driver, contract);
    const columns = result.namespaces['public']?.tables['user']?.columns ?? {};
    const read = (name: string) => ({
      resolved: columns[name]?.resolvedDefault,
      value: columns[name]?.defaultValue,
    });

    expect({
      count: read('count'),
      ratio: read('ratio'),
      active: read('active').resolved,
      meta: read('meta').resolved,
      created: read('created'),
    }).toMatchObject({
      count: {
        resolved: { kind: 'literal', value: 42 },
        value: { type: 'pg/int4', value: 42 },
      },
      ratio: {
        resolved: { kind: 'literal', value: '3.10' },
        value: { type: 'pg/numeric', params: { precision: 10, scale: 2 }, value: '3.10' },
      },
      active: { kind: 'literal', value: true },
      meta: { kind: 'literal', value: { a: 2, b: 1 } },
      created: { resolved: { kind: 'function', expression: 'now()' } },
    });
    expect({
      reported: columns['blob']?.defaultValue,
      written: columns['blob']?.defaultExpressionValue,
    }).toEqual({
      reported: expect.objectContaining({ type: 'pg/bytea', value: 'aGVsbG8=' }),
      written: expect.objectContaining({ type: 'pg/bytea', value: 'aGVsbG8=' }),
    });
    expect({
      resolved: columns['bad']?.resolvedDefault,
      unreadable: columns['bad']?.defaultUnreadable,
    }).toEqual({
      resolved: undefined,
      unreadable: expect.stringContaining(
        "The column codec pg/int4@1 cannot read the default the database reports, 'x'::integer: ",
      ),
    });
  });
});
