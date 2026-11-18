import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { mysqlDataTypes } from '@internal/target-mysql/data-types';
import { describe, expect, it } from 'vitest';
import {
  buildMysqlSchemaIR,
  type MysqlCatalogRows,
  type MysqlColumnRow,
  type ReadLiteralDefault,
} from '../src/core/migrations/introspection';

const column = (
  table_name: string,
  column_name: string,
  ordinal_position: number,
  column_type: string,
  overrides: Partial<MysqlColumnRow> = {},
): MysqlColumnRow => ({
  table_name,
  column_name,
  ordinal_position: String(ordinal_position),
  column_default: null,
  is_nullable: 'NO',
  column_type,
  extra: '',
  ...overrides,
});

const index = (
  table_name: string,
  index_name: string,
  columns: readonly string[],
  unique: boolean,
) =>
  columns.map((column_name, position) => ({
    table_name,
    index_name,
    non_unique: unique ? '0' : '1',
    seq_in_index: String(position + 1),
    column_name,
    expression: null,
  }));

const rows: MysqlCatalogRows = {
  tables: ['Post', 'User'],
  columns: [
    column('User', 'role', 3, "enum('USER','ADMIN')", { column_default: 'USER' }),
    column('User', 'id', 1, 'int', { extra: 'auto_increment' }),
    column('User', 'email', 2, 'varchar(191)'),
    column('User', 'createdAt', 4, 'datetime(3)', {
      column_default: 'CURRENT_TIMESTAMP(3)',
      extra: 'DEFAULT_GENERATED',
    }),
    column('Post', 'id', 1, 'int', { extra: 'auto_increment' }),
    column('Post', 'authorId', 2, 'int'),
    column('Post', 'editorId', 3, 'int', { is_nullable: 'YES' }),
  ],
  indexes: [
    ...index('User', 'PRIMARY', ['id'], true),
    ...index('User', 'User_email_key', ['email'], true),
    ...index('Post', 'PRIMARY', ['id'], true),
    ...index('Post', 'Post_authorId_idx', ['authorId'], false),
    ...index('Post', 'Post_editorId_fkey', ['editorId'], false),
  ],
  constraints: [
    { table_name: 'User', constraint_name: 'PRIMARY', constraint_type: 'PRIMARY KEY' },
    { table_name: 'User', constraint_name: 'User_email_key', constraint_type: 'UNIQUE' },
    { table_name: 'Post', constraint_name: 'Post_authorId_fkey', constraint_type: 'FOREIGN KEY' },
    { table_name: 'Post', constraint_name: 'Post_editorId_fkey', constraint_type: 'FOREIGN KEY' },
  ],
  foreignKeys: [
    {
      table_name: 'Post',
      constraint_name: 'Post_editorId_fkey',
      column_name: 'editorId',
      ordinal_position: '1',
      referenced_table_schema: null,
      referenced_table_name: 'User',
      referenced_column_name: 'id',
      update_rule: 'CASCADE',
      delete_rule: 'SET NULL',
    },
    {
      table_name: 'Post',
      constraint_name: 'Post_authorId_fkey',
      column_name: 'authorId',
      ordinal_position: '1',
      referenced_table_schema: null,
      referenced_table_name: 'User',
      referenced_column_name: 'id',
      update_rule: 'NO ACTION',
      delete_rule: 'RESTRICT',
    },
  ],
};

const readLiteral: ReadLiteralDefault = async (_table, _column, raw, body) => ({
  resolvedDefault: {
    kind: 'literal',
    value: typeof body === 'string' ? body : `${raw} as ${body.length} bytes`,
  },
});

describe('buildMysqlSchemaIR', () => {
  it('maps the catalog rows of a database to its schema IR', async () => {
    const schema = await buildMysqlSchemaIR(rows, mysqlDataTypes, readLiteral);
    expect(schema).toEqual(
      new SqlSchemaIR({
        tables: {
          Post: {
            name: 'Post',
            columns: {
              id: {
                name: 'id',
                typeText: 'int',
                nullable: false,
                resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
              },
              authorId: { name: 'authorId', typeText: 'int', nullable: false },
              editorId: { name: 'editorId', typeText: 'int', nullable: true },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [
              {
                columns: ['authorId'],
                referencedTable: 'User',
                referencedColumns: ['id'],
                name: 'Post_authorId_fkey',
                onDelete: 'restrict',
              },
              {
                columns: ['editorId'],
                referencedTable: 'User',
                referencedColumns: ['id'],
                name: 'Post_editorId_fkey',
                onDelete: 'setNull',
                onUpdate: 'cascade',
              },
            ],
            uniques: [],
            indexes: [
              {
                columns: ['authorId'],
                naming: { kind: 'exact', name: 'Post_authorId_idx' },
                unique: false,
                where: undefined,
                partial: false,
                type: undefined,
                options: undefined,
                annotations: undefined,
                dependsOn: undefined,
              },
            ],
          },
          User: {
            name: 'User',
            columns: {
              id: {
                name: 'id',
                typeText: 'int',
                nullable: false,
                resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
              },
              email: { name: 'email', typeText: 'varchar(191)', nullable: false },
              role: {
                name: 'role',
                typeText: "enum('USER','ADMIN')",
                nullable: false,
                default: 'USER',
                resolvedDefault: { kind: 'literal', value: 'USER' },
              },
              createdAt: {
                name: 'createdAt',
                typeText: 'datetime(3)',
                nullable: false,
                default: 'CURRENT_TIMESTAMP(3)',
                resolvedDefault: { kind: 'function', expression: 'now()' },
              },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [{ columns: ['email'], name: 'User_email_key' }],
            indexes: [],
          },
        },
      }),
    );
  });

  it('reads a boolean, bytes and JSON column and their defaults, the bytes as the hex literal MySQL reports', async () => {
    const column = (
      column_name: string,
      column_type: string,
      column_default: string | null,
      extra: string,
    ) => ({
      table_name: 'Flags',
      column_name,
      ordinal_position: String(column_name.length),
      column_default,
      is_nullable: 'NO',
      column_type,
      extra,
    });
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['Flags'],
        columns: [
          column('on', 'tinyint(1)', '1', ''),
          column('data', 'longblob', '0x00ff', 'DEFAULT_GENERATED'),
          column('doc', 'json', '_utf8mb4\\\'{"a": 1}\\\'', 'DEFAULT_GENERATED'),
          column('small', 'tinyint', null, ''),
        ],
        indexes: [],
        constraints: [],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    const columns = schema.tables['Flags']?.columns ?? {};
    expect(
      Object.fromEntries(
        Object.entries(columns).map(([name, read]) => [
          name,
          [read.storedType?.id, read.resolvedDefault],
        ]),
      ),
    ).toEqual({
      on: ['mysql/boolean', { kind: 'literal', value: '1' }],
      data: ['mysql/longblob', { kind: 'literal', value: '0x00ff as 2 bytes' }],
      doc: ['mysql/json', { kind: 'literal', value: '{"a": 1}' }],
      small: [undefined, undefined],
    });
  });

  it('reports a text default on a bytes column as unreadable, without reading it as bytes', async () => {
    const read: string[] = [];
    const recordingReadLiteral: ReadLiteralDefault = async (table, name, raw, body) => {
      read.push(name);
      return readLiteral(table, name, raw, body);
    };
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['Blobs'],
        columns: [
          column('Blobs', 'mysql', 1, 'longblob', {
            column_default: "_utf8mb4\\'abcd\\'",
            extra: 'DEFAULT_GENERATED',
          }),
          column('Blobs', 'mariadb', 2, 'longblob', { column_default: 'abcd' }),
          column('Blobs', 'hex', 3, 'longblob', {
            column_default: '0x61626364',
            extra: 'DEFAULT_GENERATED',
          }),
          column('Blobs', 'fixed', 4, 'varbinary(4)', { column_default: 'abcd' }),
          column('Blobs', 'note', 5, 'text', {
            column_default: "_utf8mb4\\'abcd\\'",
            extra: 'DEFAULT_GENERATED',
          }),
        ],
        indexes: [],
        constraints: [],
        foreignKeys: [],
      },
      mysqlDataTypes,
      recordingReadLiteral,
    );
    const columns = schema.tables['Blobs']?.columns ?? {};
    const textOnBytes = (type: string) =>
      `The database reports the default 'abcd' on this ${type} column, which is text, not bytes. Prisma reads a bytes default only when it is written as a hexadecimal literal, such as X'00FF'. Write the default as one, as in DEFAULT (X'61626364'), or remove it.`;
    expect(
      Object.fromEntries(
        Object.entries(columns).map(([name, c]) => [
          name,
          [c.resolvedDefault, c.defaultUnreadable],
        ]),
      ),
    ).toEqual({
      mysql: [undefined, textOnBytes('longblob')],
      mariadb: [undefined, textOnBytes('longblob')],
      hex: [{ kind: 'literal', value: '0x61626364 as 4 bytes' }, undefined],
      fixed: [undefined, textOnBytes('varbinary(4)')],
      note: [{ kind: 'literal', value: 'abcd' }, undefined],
    });
    expect(read).toEqual(['hex', 'note']);
  });

  it('resolves each column’s reported type to the data type that claims it', async () => {
    const schema = await buildMysqlSchemaIR(rows, mysqlDataTypes, readLiteral);
    const email = schema.tables['User']?.columns['email'];
    const role = schema.tables['User']?.columns['role'];
    expect({
      email: [email?.storedType?.id, email?.storedTypeParams],
      role: [role?.storedType?.id, role?.reportedType?.text],
    }).toEqual({
      email: ['mysql/varchar', { length: 191 }],
      role: [undefined, "enum('USER','ADMIN')"],
    });
  });

  it('reports a unique index as a unique constraint, as MySQL lists every unique index as one', async () => {
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['T'],
        columns: [column('T', 'handle', 1, 'varchar(191)')],
        indexes: index('T', 'T_handle_idx', ['handle'], true),
        constraints: [
          { table_name: 'T', constraint_name: 'T_handle_idx', constraint_type: 'UNIQUE' },
        ],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    expect({ uniques: schema.tables['T']?.uniques, indexes: schema.tables['T']?.indexes }).toEqual({
      uniques: [expect.objectContaining({ columns: ['handle'], name: 'T_handle_idx' })],
      indexes: [],
    });
  });

  it('reports a unique index the contract declares as a unique index', async () => {
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['T'],
        columns: [
          column('T', 'handle', 1, 'varchar(191)'),
          column('T', 'email', 2, 'varchar(191)'),
        ],
        indexes: [
          ...index('T', 'T_handle_idx', ['handle'], true),
          ...index('T', 'T_email_key', ['email'], true),
        ],
        constraints: [
          { table_name: 'T', constraint_name: 'T_handle_idx', constraint_type: 'UNIQUE' },
          { table_name: 'T', constraint_name: 'T_email_key', constraint_type: 'UNIQUE' },
        ],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
      {
        declaresIndex: (table, name) => table === 'T' && name === 'T_handle_idx',
        declaresUniqueIndex: (table, name) => table === 'T' && name === 'T_handle_idx',
      },
    );
    expect({ uniques: schema.tables['T']?.uniques, indexes: schema.tables['T']?.indexes }).toEqual({
      uniques: [expect.objectContaining({ columns: ['email'], name: 'T_email_key' })],
      indexes: [
        expect.objectContaining({
          columns: ['handle'],
          name: 'T_handle_idx',
          unique: true,
        }),
      ],
    });
  });

  it('leaves out the index InnoDB creates for a foreign key', async () => {
    const schema = await buildMysqlSchemaIR(rows, mysqlDataTypes, readLiteral);
    expect(schema.tables['Post']?.indexes.map((entry) => entry.name)).toEqual([
      'Post_authorId_idx',
    ]);
  });

  it('keeps an index the contract declares with the name and columns of a foreign key', async () => {
    const schema = await buildMysqlSchemaIR(rows, mysqlDataTypes, readLiteral, {
      declaresIndex: (table, name) => table === 'Post' && name === 'Post_editorId_fkey',
      declaresUniqueIndex: () => false,
    });
    expect(
      schema.tables['Post']?.indexes.map(({ name, columns, unique }) => ({
        name,
        columns,
        unique,
      })),
    ).toEqual([
      { name: 'Post_authorId_idx', columns: ['authorId'], unique: false },
      { name: 'Post_editorId_fkey', columns: ['editorId'], unique: false },
    ]);
  });

  it('reports a unique expression index as an index with its expression', async () => {
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['T'],
        columns: [column('T', 'name', 1, 'varchar(191)')],
        indexes: [
          {
            table_name: 'T',
            index_name: 'by_lower',
            non_unique: '0',
            seq_in_index: '1',
            column_name: null,
            expression: 'lower(`name`)',
          },
        ],
        constraints: [{ table_name: 'T', constraint_name: 'by_lower', constraint_type: 'UNIQUE' }],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    expect({
      uniques: schema.tables['T']?.uniques,
      indexes: schema.tables['T']?.indexes.map(({ expression, unique }) => ({
        expression,
        unique,
      })),
    }).toEqual({ uniques: [], indexes: [{ expression: 'lower(`name`)', unique: true }] });
  });

  it('reports an expression index by its expression', async () => {
    const schema = await buildMysqlSchemaIR(
      {
        tables: ['T'],
        columns: [column('T', 'name', 1, 'varchar(191)')],
        indexes: [
          {
            table_name: 'T',
            index_name: 'by_lower',
            non_unique: '1',
            seq_in_index: '1',
            column_name: null,
            expression: 'lower(`name`)',
          },
        ],
        constraints: [],
        foreignKeys: [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    expect(schema.tables['T']?.indexes.map((entry) => entry.expression)).toEqual(['lower(`name`)']);
  });

  it('names the database of a table a foreign key references in another database', async () => {
    const [foreignKey] = rows.foreignKeys;
    const schema = await buildMysqlSchemaIR(
      {
        ...rows,
        foreignKeys: foreignKey ? [{ ...foreignKey, referenced_table_schema: 'accounts' }] : [],
      },
      mysqlDataTypes,
      readLiteral,
    );
    expect(
      schema.tables['Post']?.foreignKeys.map(({ referencedSchema, referencedTable }) => ({
        referencedSchema,
        referencedTable,
      })),
    ).toEqual([{ referencedSchema: 'accounts', referencedTable: 'User' }]);
  });

  it('refuses a referential action it does not know', async () => {
    const [foreignKey] = rows.foreignKeys;
    await expect(
      buildMysqlSchemaIR(
        { ...rows, foreignKeys: foreignKey ? [{ ...foreignKey, delete_rule: 'EXPLODE' }] : [] },
        mysqlDataTypes,
        readLiteral,
      ),
    ).rejects.toThrow(/Unknown referential action rule in the MySQL or MariaDB catalog: "EXPLODE"/);
  });
});
