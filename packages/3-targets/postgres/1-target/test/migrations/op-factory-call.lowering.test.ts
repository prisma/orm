import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { opaqueSql } from '@internal/sql-relational-core/ast';
import { col, fn, lit } from '@internal/sql-relational-core/contract-free';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  columnExistsAst,
  columnTypeAst,
  indexDefinitionAst,
  indexExistsAst,
  nativeEnumTypeExistsAst,
  nativeEnumValueExistsAst,
  rlsEnabledAst,
  rlsPolicyDefinitionAst,
  rlsPolicyExistsAst,
  tableExistsAst,
} from '../../src/contract-free/checks';
import { alterColumnTypeAction, alterTable } from '../../src/contract-free/ddl';
import { postgresDataTypes } from '../../src/core/data-types';
import {
  PostgresAlterIndexRename,
  PostgresCreateIndex,
  PostgresDropIndex,
} from '../../src/core/ddl/nodes';
import {
  AddColumnCall,
  AddNativeEnumValueCall,
  AddRequiredColumnToEmptyTableCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateNativeEnumTypeCall,
  CreatePostgresRlsPolicyCall,
  CreateSchemaCall,
  DataTransformCall,
  DisableRowLevelSecurityCall,
  DropColumnCall,
  DropDefaultCall,
  DropExtensionCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropNotNullCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  EnableRowLevelSecurityCall,
  RawSqlCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  SetDefaultCall,
  SetExtensionSchemaCall,
  SetNotNullCall,
} from '../../src/core/migrations/op-factory-call';
import { PostgresRlsPolicy } from '../../src/core/postgres-rls-policy';

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('DropTableCall', () => {
  it('lowers typed table-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropTableCall('public', 'user');
    const op = await call.toOp(lowerer);

    const checks = tableExistsAst('public', 'user');
    expect(received).toEqual([checks.tablePresent(), checks.tableAbsent()]);
    expect(op.id).toBe('dropTable.user');
    expect(op.operationClass).toBe('destructive');
    expect(op.target).toEqual({
      id: 'postgres',
      details: { schema: 'public', objectType: 'table', name: 'user' },
    });
    expect(op.precheck).toEqual([
      {
        description: 'ensure table "user" exists',
        expectation: { expects: 'present', object: 'table "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.execute).toEqual([
      { description: 'drop table "user"', sql: 'DROP TABLE "public"."user"' },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify table "user" does not exist',
        expectation: { expects: 'absent', object: 'table "user"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(call.label).toBe('Drop table "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropTableCall('public', 'user');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropTable, omitting schema for the unbound namespace', () => {
    expect(new DropTableCall('public', 'user').renderTypeScript()).toBe(
      'this.dropTable({ schema: "public", table: "user" })',
    );
    expect(new DropTableCall('__unbound__', 'user').renderTypeScript()).toBe(
      'this.dropTable({ table: "user" })',
    );
    expect(new DropTableCall('public', 'user').importRequirements()).toEqual([]);
  });
});

describe('AddColumnCall', () => {
  it('lowers a typed AlterTable DDL node and typed column-existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddColumnCall('public', 'user', col('bio', 'text'), postgresDataTypes);
    const op = await call.toOp(lowerer);

    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'bio' });
    expect(received[1]).toEqual(colChecks.columnAbsent());
    expect(received[2]).toEqual(colChecks.columnPresent());
    expect(received[3]).toEqual(
      columnTypeAst({ schema: 'public', table: 'user', column: 'bio', expectedType: 'text' }),
    );
    expect(op.id).toBe('column.public.user.bio');
    expect(op.target).toEqual({
      id: 'postgres',
      details: { schema: 'public', objectType: 'column', name: 'bio', table: 'user' },
    });
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "bio" is missing',
        expectation: { expects: 'absent', object: 'column "bio" on "user"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.execute).toEqual([{ description: 'add column "bio"', sql: 'LOWERED 1' }]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify column "bio" exists',
        expectation: { expects: 'present', object: 'column "bio" on "user"' },
        sql: 'LOWERED 3',
        params: ['p3'],
      },
      { description: 'verify column "bio" has type "text"', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(call.label).toBe('Add column "bio" to "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddColumnCall('public', 'user', col('bio', 'text'), postgresDataTypes);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.addColumn with column options and imports col plus the default helper', () => {
    const call = new AddColumnCall(
      'public',
      'user',
      col('bio', 'text', { notNull: true, default: lit('active') }),
      postgresDataTypes,
    );
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("bio", "text", { notNull: true, default: lit("active") }) })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'col' },
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'lit' },
    ]);
  });

  it('renders a function default holding both quote kinds as a sql template', () => {
    const call = new AddColumnCall(
      'public',
      'user',
      col('label', 'text', { default: fn(`concat("prefix", 'user')`) }),
      postgresDataTypes,
    );
    expect(call.renderTypeScript()).toBe(
      'this.addColumn({ schema: "public", table: "user", column: col("label", "text", { default: fn(sql`concat("prefix", \'user\')`) }) })',
    );
    expect(call.importRequirements()).toContainEqual({
      moduleSpecifier: '@internal/postgres/migration',
      symbol: 'sql',
    });
  });
});

describe('DropColumnCall', () => {
  it('lowers typed column-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropColumnCall('public', 'user', 'bio');
    const op = await call.toOp(lowerer);

    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'bio' });
    expect(received).toEqual([colChecks.columnPresent(), colChecks.columnAbsent()]);
    expect(op.execute).toEqual([
      { description: 'drop column "bio"', sql: 'ALTER TABLE "public"."user" DROP COLUMN "bio"' },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(call.label).toBe('Drop column "bio" from "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropColumnCall('public', 'user', 'bio');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropColumn with no facade import', () => {
    const call = new DropColumnCall('public', 'user', 'bio');
    expect(call.renderTypeScript()).toBe(
      'this.dropColumn({ schema: "public", table: "user", column: "bio" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AlterColumnTypeCall', () => {
  const alter = (
    overrides: Partial<ConstructorParameters<typeof AlterColumnTypeCall>[0]> = {},
  ): AlterColumnTypeCall =>
    new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: 'public',
      tableName: 'user',
      columnName: 'age',
      type: 'int8',
      dataTypes: postgresDataTypes,
      ...overrides,
    });

  it('lowers typed checks and a typed ALTER COLUMN TYPE node with no USING text', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = alter();
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(4);
    expect(received[3]).toEqual(
      alterTable({
        schema: 'public',
        table: 'user',
        actions: [alterColumnTypeAction({ columnName: 'age', type: 'int8' })],
      }),
    );
    expect(op.execute).toEqual([
      {
        description: 'alter type of "age" to int8',
        sql: 'LOWERED 4',
        meta: { convertedColumn: { table: 'user', column: 'age', by: 'cast' } },
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "age" exists',
        expectation: { expects: 'present', object: 'column "age" on "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify column "age" has type "bigint"',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(op.meta).toEqual({ warning: 'TABLE_REWRITE' });
    expect(call.label).toBe('Alter type of "user"."age" to int8');
  });

  it('marks a destructive cast of its own as a cast, and a USING conversion as a conversion', async () => {
    const { lowerer } = recordingCheckLowerer();
    const metaOf = async (call: AlterColumnTypeCall) => (await call.toOp(lowerer)).execute[0]?.meta;
    expect([
      await metaOf(alter()),
      await metaOf(alter({ operationClass: 'widening' })),
      await metaOf(alter({ using: { kind: 'sql', sql: '"age"::int8' } })),
      await metaOf(
        alter({ using: { kind: 'sql', sql: '"age"::int8' }, operationClass: 'destructive' }),
      ),
    ]).toEqual([
      { convertedColumn: { table: 'user', column: 'age', by: 'cast' } },
      undefined,
      { convertedColumn: { table: 'user', column: 'age', by: 'conversion' } },
      { convertedColumn: { table: 'user', column: 'age', by: 'conversion' } },
    ]);
  });

  it('is a data change when it converts with a USING clause and nothing says otherwise', () => {
    expect([
      alter({ using: { kind: 'sql', sql: '"age"::int8' } }).operationClass,
      alter({ using: { kind: 'placeholder', slot: 'User.age:convert' } }).operationClass,
      alter({ using: { kind: 'sql', sql: '"age"::int8' }, operationClass: 'destructive' })
        .operationClass,
    ]).toEqual(['data', 'data', 'destructive']);
  });

  it('is destructive unless the planner says the type change is a safe widening or a conversion', async () => {
    const { lowerer } = recordingCheckLowerer();
    const classes = await Promise.all(
      [
        alter(),
        alter({ operationClass: 'widening' }),
        alter({ operationClass: 'data', using: { kind: 'sql', sql: '"age"::int8' } }),
      ].map(async (call) => [call.operationClass, (await call.toOp(lowerer)).operationClass]),
    );
    expect(classes).toEqual([
      ['destructive', 'destructive'],
      ['widening', 'widening'],
      ['data', 'data'],
    ]);
  });

  it('passes an explicit USING text to the ALTER COLUMN TYPE node', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    await alter({ using: { kind: 'sql', sql: `nullif("age", ';')::int8` } }).toOp(lowerer);
    expect(received[3]).toEqual(
      alterTable({
        schema: 'public',
        table: 'user',
        actions: [
          alterColumnTypeAction({
            columnName: 'age',
            type: 'int8',
            using: `nullif("age", ';')::int8`,
          }),
        ],
      }),
    );
  });

  it('refuses a USING clause that could end or extend the statement, naming the call', () => {
    const refusal = (sql: string) => {
      try {
        alter({ using: { kind: 'sql', sql } });
        return undefined;
      } catch (error) {
        return error;
      }
    };
    expect(refusal('"age"::int8; DROP TABLE "user"')).toMatchObject({
      code: 'MIGRATION.SQL_EXPRESSION_INVALID',
      message:
        'alterColumnType({ schema: "public", table: "user", column: "age" }): using "\\"age\\"::int8; DROP TABLE \\"user\\"" holds a semicolon outside a quoted literal, which could end or extend the ALTER COLUMN … TYPE statement it is written into',
    });
    expect(
      ['age::int8 -- widen', '"age" FROM "user"', '1 UNION SELECT 2', '"age"::int8, DROP "x"'].map(
        (sql) => (refusal(sql) as { code?: string } | undefined)?.code,
      ),
    ).toEqual(Array(4).fill('MIGRATION.SQL_EXPRESSION_INVALID'));
  });

  it('reads USING with Postgres quoting: E strings with backslash escapes, no bracket or backtick quotes', () => {
    const refusedFor = (sql: string) => {
      try {
        alter({ using: { kind: 'sql', sql } });
        return undefined;
      } catch (error) {
        return (error as { meta?: { refused?: string } }).meta?.refused;
      }
    };
    expect(
      [
        `ARRAY[']']::int8[]`,
        `E'it\\'s'`,
        `E'\\'' ; DROP TABLE "User"; --'`,
        '`a;b`',
        `"name" IS DISTINCT FROM 'al'`,
        `"name" IS NOT DISTINCT FROM 'al'`,
      ].map(refusedFor),
    ).toEqual([
      undefined,
      undefined,
      'a semicolon outside a quoted literal',
      'a semicolon outside a quoted literal',
      undefined,
      undefined,
    ]);
  });

  it('advises parentheses when USING is refused', () => {
    expect(() => alter({ using: { kind: 'sql', sql: '"age" FROM "user"' } })).toThrow(
      expect.objectContaining({
        fix: expect.stringContaining('wrap it in parentheses'),
      }),
    );
  });

  it('is an unfilled placeholder while its USING slot is unfilled', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = alter({
      operationClass: 'data',
      using: { kind: 'placeholder', slot: 'User.age:convert' },
    });
    await expect(call.toOp(lowerer)).rejects.toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
    });
  });

  it('refuses a type no data type of the stack reads, naming the call', () => {
    expect(() => alter({ type: 'int9' })).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.COLUMN_TYPE_UNREADABLE',
        meta: {
          type: 'int9',
          where: 'alterColumnType({ schema: "public", table: "user", column: "age" })',
        },
      }),
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    await expect(async () => alter().toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.alterColumnType with plain options, and the class when it is not the default', () => {
    expect([
      alter().renderTypeScript(),
      alter({ operationClass: 'widening' }).renderTypeScript(),
      alter({
        using: { kind: 'sql', sql: '"age"::int8' },
        operationClass: 'destructive',
      }).renderTypeScript(),
    ]).toEqual([
      'this.alterColumnType({ schema: "public", table: "user", column: "age", type: "int8" })',
      'this.alterColumnType({ schema: "public", table: "user", column: "age", type: "int8", operationClass: "widening" })',
      'this.alterColumnType({ schema: "public", table: "user", column: "age", type: "int8", using: sql`"age"::int8`, operationClass: "destructive" })',
    ]);
    expect(alter().importRequirements()).toEqual([]);
  });

  it('marks a raw type in the call it renders, and checks it as written', () => {
    const call = alter({ type: 'circle', raw: true });
    expect({ source: call.renderTypeScript(), checkType: call.checkType }).toEqual({
      source:
        'this.alterColumnType({ schema: "public", table: "user", column: "age", type: "circle", raw: true })',
      checkType: { kind: 'catalog-text', text: 'circle' },
    });
  });

  it('renders an unfilled USING slot as a placeholder call, and imports placeholder', () => {
    const call = alter({ using: { kind: 'placeholder', slot: 'User.age:convert' } });
    expect(call.renderTypeScript()).toBe(
      'this.alterColumnType({ schema: "public", table: "user", column: "age", type: "int8", using: placeholder("User.age:convert") })',
    );
    expect(call.importRequirements()).toEqual([expect.objectContaining({ symbol: 'placeholder' })]);
  });
});

describe('AddRequiredColumnToEmptyTableCall', () => {
  it('marks its empty-table precheck as the check a new required column fails on a table with rows', async () => {
    const { lowerer } = recordingCheckLowerer();
    const op = await new AddRequiredColumnToEmptyTableCall(
      'public',
      'user',
      'code',
      'text',
      postgresDataTypes,
    ).toOp(lowerer);
    expect(op.precheck.map(({ meta }) => meta)).toEqual([
      undefined,
      { requiredColumn: { table: 'user', column: 'code', reason: 'newField' } },
    ]);
  });
});

describe('SetNotNullCall', () => {
  it('lowers typed checks and sets NOT NULL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new SetNotNullCall('public', 'user', 'email');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(4);
    expect(op.execute).toEqual([
      {
        description: 'set NOT NULL on "email"',
        sql: 'ALTER TABLE "public"."user" ALTER COLUMN "email" SET NOT NULL',
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "email" exists',
        expectation: { expects: 'present', object: 'column "email" on "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
      {
        description: 'ensure no NULL values in "email"',
        sql: 'LOWERED 3',
        params: ['p3'],
        meta: { requiredColumn: { table: 'user', column: 'email', reason: 'nullValues' } },
      },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "email" is NOT NULL', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(call.label).toBe('Set NOT NULL on "user"."email"');
  });

  it('is widening, because its precheck fails rather than losing a NULL value', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new SetNotNullCall('public', 'user', 'email');
    const op = await call.toOp(lowerer);
    expect([call.operationClass, op.operationClass]).toEqual(['widening', 'widening']);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new SetNotNullCall('public', 'user', 'email');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.setNotNull with no facade import', () => {
    const call = new SetNotNullCall('public', 'user', 'email');
    expect(call.renderTypeScript()).toBe(
      'this.setNotNull({ schema: "public", table: "user", column: "email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DropNotNullCall', () => {
  it('lowers typed checks and drops NOT NULL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropNotNullCall('public', 'user', 'email');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(3);
    expect(op.operationClass).toBe('widening');
    expect(op.execute).toEqual([
      {
        description: 'drop NOT NULL on "email"',
        sql: 'ALTER TABLE "public"."user" ALTER COLUMN "email" DROP NOT NULL',
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "email" exists',
        expectation: { expects: 'present', object: 'column "email" on "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "email" is nullable', sql: 'LOWERED 3', params: ['p3'] },
    ]);
    expect(call.label).toBe('Drop NOT NULL on "user"."email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropNotNullCall('public', 'user', 'email');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropNotNull with no facade import', () => {
    const call = new DropNotNullCall('public', 'user', 'email');
    expect(call.renderTypeScript()).toBe(
      'this.dropNotNull({ schema: "public", table: "user", column: "email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('SetDefaultCall', () => {
  const status = col('status', 'text', {
    default: lit('pending'),
    codecRef: { codecId: 'pg/text@1' },
  });

  function renderingLowerer() {
    const { lowerer, received } = recordingCheckLowerer();
    const rendered: unknown[] = [];
    const withDefaults: ExecuteRequestLowerer = {
      ...lowerer,
      renderColumnDefault: async (column, table) => {
        rendered.push({ column, table });
        return "DEFAULT 'pending'";
      },
    };
    return { lowerer: withDefaults, received, rendered };
  }

  it('sets the default clause the adapter writes for the column, and lowers typed checks', async () => {
    const { lowerer, received, rendered } = renderingLowerer();
    const call = new SetDefaultCall('public', 'user', status, 'additive');
    const op = await call.toOp(lowerer);

    expect({
      rendered,
      checks: received.length,
      operationClass: op.operationClass,
      execute: op.execute,
      precheck: op.precheck,
      postcheck: op.postcheck,
      label: call.label,
    }).toEqual({
      rendered: [{ column: status, table: 'user' }],
      checks: 2,
      operationClass: 'additive',
      execute: [
        {
          description: 'set default on "status"',
          sql: `ALTER TABLE "public"."user" ALTER COLUMN "status" SET DEFAULT 'pending'`,
        },
      ],
      precheck: [
        {
          description: 'ensure column "status" exists',
          expectation: { expects: 'present', object: 'column "status" on "user"' },
          sql: 'LOWERED 1',
          params: ['p1'],
        },
      ],
      postcheck: [],
      label: 'Set default on "user"."status"',
    });
  });

  it('carries no postcheck when it changes a default, because the runner would skip an operation whose postcheck the old default already passes', async () => {
    const { lowerer } = renderingLowerer();
    const call = new SetDefaultCall('public', 'user', status, 'widening');
    const op = await call.toOp(lowerer);
    expect({
      operationClass: op.operationClass,
      precheck: op.precheck,
      postcheck: op.postcheck,
    }).toEqual({
      operationClass: 'widening',
      precheck: [
        {
          description: 'ensure column "status" exists',
          expectation: { expects: 'present', object: 'column "status" on "user"' },
          sql: 'LOWERED 1',
          params: ['p1'],
        },
      ],
      postcheck: [],
    });
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new SetDefaultCall('public', 'user', status, 'additive');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.setDefault with the column and never the operation class, which the migration derives from its start contract', () => {
    const additive = new SetDefaultCall('public', 'user', status, 'additive');
    const widening = new SetDefaultCall('public', 'user', status, 'widening');
    const column =
      'col("status", "text", { default: lit("pending"), codecRef: { codecId: "pg/text@1" } })';
    expect({
      additive: additive.renderTypeScript(),
      widening: widening.renderTypeScript(),
      imports: additive.importRequirements().map((requirement) => requirement.symbol),
    }).toEqual({
      additive: `this.setDefault({ schema: "public", table: "user", column: ${column} })`,
      widening: `this.setDefault({ schema: "public", table: "user", column: ${column} })`,
      imports: ['col', 'lit'],
    });
  });

  it('renders a default holding both quote kinds as a sql template', () => {
    const meta = col('meta', 'jsonb', { default: fn(`'{"a": 1}'::jsonb`) });
    const call = new SetDefaultCall('public', 'user', meta, 'additive');
    expect(call.renderTypeScript()).toBe(
      'this.setDefault({ schema: "public", table: "user", column: col("meta", "jsonb", { default: fn(sql`\'{"a": 1}\'::jsonb`) }) })',
    );
  });
});

describe('DropDefaultCall', () => {
  it('lowers a typed AlterTable DDL node and typed default-presence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropDefaultCall('public', 'user', 'status');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(4);
    expect(op.execute).toEqual([{ description: 'drop default on "status"', sql: 'LOWERED 3' }]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "status" exists',
        expectation: { expects: 'present', object: 'column "status" on "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "status" has no default', sql: 'LOWERED 4', params: ['p4'] },
    ]);
    expect(call.label).toBe('Drop default on "user"."status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropDefaultCall('public', 'user', 'status');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropDefault with no facade import', () => {
    const call = new DropDefaultCall('public', 'user', 'status');
    expect(call.renderTypeScript()).toBe(
      'this.dropDefault({ schema: "public", table: "user", column: "status" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AddNativeEnumValueCall', () => {
  it('lowers typed enum checks and appends the value via ALTER TYPE', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    const op = await call.toOp(lowerer);

    const typeChecks = nativeEnumTypeExistsAst('public', 'status');
    const valueChecks = nativeEnumValueExistsAst({
      schema: 'public',
      typeName: 'status',
      value: 'archived',
    });
    expect(received).toEqual([
      typeChecks.typePresent(),
      valueChecks.valueAbsent(),
      valueChecks.valuePresent(),
    ]);
    expect(op.execute).toEqual([
      {
        description: 'add value "archived" to enum type "status"',
        sql: `ALTER TYPE "public"."status" ADD VALUE 'archived'`,
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure enum type "status" exists',
        expectation: { expects: 'present', object: 'enum type "status"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
      {
        description: 'ensure value "archived" is absent from enum type "status"',
        expectation: { expects: 'absent', object: 'value "archived" in enum type "status"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify value "archived" exists on enum type "status"',
        expectation: { expects: 'present', object: 'value "archived" in enum type "status"' },
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Add value "archived" to enum type "status"');
    expect(call.summary).toContain('A newly added enum value cannot be used until the transaction');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.addNativeEnumValue with no facade import', () => {
    const call = new AddNativeEnumValueCall('public', 'status', 'archived');
    expect(call.renderTypeScript()).toBe(
      'this.addNativeEnumValue({ schema: "public", typeName: "status", value: "archived" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateNativeEnumTypeCall', () => {
  it('lowers a typed CREATE TYPE DDL node', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'create enum type "status"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Create enum type "status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.createNativeEnumType with no facade import', () => {
    const call = new CreateNativeEnumTypeCall('public', 'status', ['active', 'inactive']);
    expect(call.renderTypeScript()).toBe(
      'this.createNativeEnumType({ schema: "public", typeName: "status", members: ["active", "inactive"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DropNativeEnumTypeCall', () => {
  it('lowers a typed DROP TYPE DDL node', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropNativeEnumTypeCall('public', 'status');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'drop enum type "status"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Drop enum type "status"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropNativeEnumTypeCall('public', 'status');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropNativeEnumType with no facade import', () => {
    const call = new DropNativeEnumTypeCall('public', 'status');
    expect(call.renderTypeScript()).toBe(
      'this.dropNativeEnumType({ schema: "public", typeName: "status" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateSchemaCall', () => {
  it('lowers a typed CREATE SCHEMA DDL node', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateSchemaCall('tenant');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(1);
    expect(op.id).toBe('schema.tenant');
    expect(op.target).toEqual({ id: 'postgres' });
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'Create schema "tenant"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(call.label).toBe('Create schema "tenant"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateSchemaCall('tenant');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.createSchema with no facade import', () => {
    const call = new CreateSchemaCall('tenant');
    expect(call.renderTypeScript()).toBe('this.createSchema({ schema: "tenant" })');
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('CreateIndexCall', () => {
  it('lowers typed index-existence checks and builds a plain CREATE INDEX', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    const op = await call.toOp(lowerer);

    const checks = indexExistsAst('public', 'idx_user_email');
    const ddlNode = received[0] as PostgresCreateIndex;
    expect(ddlNode).toBeInstanceOf(PostgresCreateIndex);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.table).toBe('user');
    expect(ddlNode.name).toBe('idx_user_email');
    expect(ddlNode.unique).toBe(false);
    expect(ddlNode.elements).toEqual({ columns: ['email'] });
    expect(received.slice(1)).toEqual([
      checks.indexAbsent(),
      indexDefinitionAst({
        schema: 'public',
        table: 'user',
        index: 'idx_user_email',
        unique: false,
        method: 'btree',
        elements: { columns: ['email'] },
        hasPredicate: false,
      }),
    ]);
    expect(op.execute).toEqual([
      {
        description: 'create index "idx_user_email"',
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure index "idx_user_email" does not exist',
        expectation: { expects: 'absent', object: 'index "idx_user_email"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify index "idx_user_email" exists on "user" with the planned definition',
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Create index "idx_user_email" on "user"');
  });

  it('renders and executes a USING/WITH clause when type and options are given', async () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'idx_user_email',
      { columns: ['email'] },
      {
        type: 'btree',
        options: { fillfactor: 90 },
      },
    );
    const { lowerer: recording, received } = recordingCheckLowerer();
    const op = await call.toOp(recording);
    const ddlNode = received[0] as PostgresCreateIndex;
    expect(ddlNode).toBeInstanceOf(PostgresCreateIndex);
    expect(ddlNode.type).toBe('btree');
    expect(ddlNode.options).toEqual({ fillfactor: 90 });
    expect(op.execute[0]?.sql).toBe('LOWERED 1');
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "idx_user_email", columns: ["email"], extras: { type: "btree", options: { fillfactor: 90 } } })',
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.createIndex with no facade import', () => {
    const call = new CreateIndexCall('public', 'user', 'idx_user_email', { columns: ['email'] });
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "idx_user_email", columns: ["email"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('renders and executes an expression element with unique and where extras', async () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'user_email_eq',
      { expression: 'lower(email)' },
      { unique: true, where: 'deleted_at IS NULL' },
    );
    const { lowerer: recording, received } = recordingCheckLowerer();
    const op = await call.toOp(recording);
    const ddlNode = received[0] as PostgresCreateIndex;
    expect(ddlNode).toBeInstanceOf(PostgresCreateIndex);
    expect(ddlNode.unique).toBe(true);
    expect(ddlNode.where).toEqual(opaqueSql('deleted_at IS NULL'));
    expect(ddlNode.elements).toEqual({ expression: opaqueSql('lower(email)') });
    expect(op.execute[0]?.sql).toBe('LOWERED 1');
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "user_email_eq", expression: sql`lower(email)`, extras: { where: sql`deleted_at IS NULL`, unique: true } })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'sql' },
    ]);
  });

  it('renders an expression and a where holding both quote kinds as sql templates', () => {
    const call = new CreateIndexCall(
      'public',
      'user',
      'user_kind_idx',
      { expression: `("kind" || 'x')` },
      { where: `"kind" <> 'guest'` },
    );
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ schema: "public", table: "user", index: "user_kind_idx", expression: sql`("kind" || \'x\')`, extras: { where: sql`"kind" <> \'guest\'` } })',
    );
  });
});

describe('RenameIndexCall', () => {
  it('renders ALTER INDEX RENAME with from-present/to-absent prechecks and to-present/from-absent postchecks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    const op = await call.toOp(lowerer);

    const fromChecks = indexExistsAst('public', 'old_email_idx');
    const toChecks = indexExistsAst('public', 'user_email_idx_46df9cad');
    expect(received[0]).toEqual(fromChecks.indexPresent());
    expect(received[1]).toEqual(toChecks.indexAbsent());
    expect(received[2]).toEqual(toChecks.indexPresent());
    expect(received[3]).toEqual(fromChecks.indexAbsent());
    const ddlNode = received[4] as PostgresAlterIndexRename;
    expect(ddlNode).toBeInstanceOf(PostgresAlterIndexRename);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.from).toBe('old_email_idx');
    expect(ddlNode.to).toBe('user_email_idx_46df9cad');
    expect(op.operationClass).toBe('widening');
    expect(op.execute).toEqual([
      {
        description: 'rename index "old_email_idx" to "user_email_idx_46df9cad"',
        sql: 'LOWERED 5',
        params: ['p5'],
      },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure index "old_email_idx" exists',
        expectation: { expects: 'present', object: 'index "old_email_idx"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
      {
        description: 'ensure index "user_email_idx_46df9cad" does not exist',
        expectation: { expects: 'absent', object: 'index "user_email_idx_46df9cad"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify index "user_email_idx_46df9cad" exists',
        expectation: { expects: 'present', object: 'index "user_email_idx_46df9cad"' },
        sql: 'LOWERED 3',
        params: ['p3'],
      },
      {
        description: 'verify index "old_email_idx" no longer exists',
        expectation: { expects: 'absent', object: 'index "old_email_idx"' },
        sql: 'LOWERED 4',
        params: ['p4'],
      },
    ]);
    expect(call.label).toBe('Rename index "old_email_idx" to "user_email_idx_46df9cad" on "user"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.renameIndex(...) with no facade import', () => {
    const call = new RenameIndexCall('public', 'user', 'old_email_idx', 'user_email_idx_46df9cad');
    expect(call.renderTypeScript()).toBe(
      'this.renameIndex({ schema: "public", table: "user", from: "old_email_idx", to: "user_email_idx_46df9cad" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('omits schema from the rendered TS for the unbound namespace, like every sibling', () => {
    const call = new RenameIndexCall(
      UNBOUND_NAMESPACE_ID,
      'user',
      'old_email_idx',
      'user_email_idx_46df9cad',
    );
    expect(call.renderTypeScript()).toBe(
      'this.renameIndex({ table: "user", from: "old_email_idx", to: "user_email_idx_46df9cad" })',
    );
  });
});

describe('DropIndexCall', () => {
  it('lowers typed index-existence checks and drops via qualified DDL', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    const op = await call.toOp(lowerer);

    const checks = indexExistsAst('public', 'idx_user_email');
    const ddlNode = received[0] as PostgresDropIndex;
    expect(ddlNode).toBeInstanceOf(PostgresDropIndex);
    expect(ddlNode.schema).toBe('public');
    expect(ddlNode.name).toBe('idx_user_email');
    expect(received.slice(1)).toEqual([checks.indexPresent(), checks.indexAbsent()]);
    expect(op.execute).toEqual([
      { description: 'drop index "idx_user_email"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure index "idx_user_email" exists',
        expectation: { expects: 'present', object: 'index "idx_user_email"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify index "idx_user_email" does not exist',
        expectation: { expects: 'absent', object: 'index "idx_user_email"' },
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
    expect(call.label).toBe('Drop index "idx_user_email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropIndex with no facade import', () => {
    const call = new DropIndexCall('public', 'user', 'idx_user_email');
    expect(call.renderTypeScript()).toBe(
      'this.dropIndex({ schema: "public", table: "user", index: "idx_user_email" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('extension calls', () => {
  it('CreateExtensionCall installs the extension in its schema, checked absent before and present after', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new CreateExtensionCall('extensions', 'postgis');
    const op = await call.toOp(lowerer);
    expect({
      id: op.id,
      operationClass: op.operationClass,
      target: op.target,
      precheck: op.precheck.map((step) => step.description),
      execute: op.execute.map((step) => step.sql),
      postcheck: op.postcheck.map((step) => step.description),
    }).toEqual({
      id: 'extension.postgis',
      operationClass: 'additive',
      target: {
        id: 'postgres',
        details: { schema: 'extensions', objectType: 'dependency', name: 'postgis' },
      },
      precheck: ['verify extension "postgis" is not installed'],
      execute: ['CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "extensions"'],
      postcheck: ['confirm extension "postgis" is installed'],
    });
    expect(call.renderTypeScript()).toBe(
      'this.createExtension({ schema: "extensions", extension: "postgis" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('DropExtensionCall drops the extension without CASCADE as a destructive operation', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new DropExtensionCall('public', 'pg_trgm');
    const op = await call.toOp(lowerer);
    expect({
      operationClass: op.operationClass,
      execute: op.execute.map((step) => step.sql),
      precheck: op.precheck.map((step) => step.description),
      postcheck: op.postcheck.map((step) => step.description),
    }).toEqual({
      operationClass: 'destructive',
      execute: ['DROP EXTENSION "pg_trgm"'],
      precheck: ['verify extension "pg_trgm" is installed'],
      postcheck: ['confirm extension "pg_trgm" is dropped'],
    });
    expect(call.renderTypeScript()).toBe(
      'this.dropExtension({ schema: "public", extension: "pg_trgm" })',
    );
  });

  it('SetExtensionSchemaCall moves the extension and checks it landed in the schema', async () => {
    const { lowerer } = recordingCheckLowerer();
    const call = new SetExtensionSchemaCall('postgis', 'extensions');
    const op = await call.toOp(lowerer);
    expect({
      operationClass: op.operationClass,
      execute: op.execute.map((step) => step.sql),
      postcheck: op.postcheck.map((step) => step.description),
    }).toEqual({
      operationClass: 'widening',
      execute: ['ALTER EXTENSION "postgis" SET SCHEMA "extensions"'],
      postcheck: ['confirm extension "postgis" is in schema "extensions"'],
    });
    expect(call.renderTypeScript()).toBe(
      'this.setExtensionSchema({ extension: "postgis", schema: "extensions" })',
    );
  });

  it('each extension call refuses to build without a lowerer', async () => {
    await expect(new CreateExtensionCall('public', 'citext').toOp()).rejects.toThrow(
      /a lowerer is required/,
    );
    await expect(new DropExtensionCall('public', 'citext').toOp()).rejects.toThrow(
      /a lowerer is required/,
    );
    await expect(new SetExtensionSchemaCall('citext', 'public').toOp()).rejects.toThrow(
      /a lowerer is required/,
    );
  });
});

describe('RawSqlCall', () => {
  const op = {
    id: 'custom.raw',
    label: 'Custom raw SQL step',
    operationClass: 'additive' as const,
    target: { id: 'postgres' },
    precheck: [],
    execute: [{ description: 'run custom sql', sql: 'SELECT 1' }],
    postcheck: [],
  };

  it('toOp() returns the wrapped op unchanged', () => {
    const call = new RawSqlCall(op);
    expect(call.toOp()).toBe(op);
    expect(call.label).toBe('Custom raw SQL step');
    expect(call.operationClass).toBe('additive');
  });

  it('renders rawSql(...) with the op serialized as a JSON literal', () => {
    const call = new RawSqlCall(op);
    const ts = call.renderTypeScript();
    expect(ts.startsWith('rawSql({')).toBe(true);
    expect(ts).toContain('id: "custom.raw"');
    expect(ts).toContain('label: "Custom raw SQL step"');
    expect(ts).toContain('sql: "SELECT 1"');
  });
});

describe('DataTransformCall', () => {
  it('toOp() always rejects with MIGRATION.UNFILLED_PLACEHOLDER for the unfilled placeholder', async () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    await expect(call.toOp()).rejects.toThrow(
      expect.objectContaining({
        code: 'MIGRATION.UNFILLED_PLACEHOLDER',
        meta: { slot: 'Backfill status' },
      }),
    );
  });

  it('defaults operationClass to "data" and carries the check/run slot names', () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    expect(call.operationClass).toBe('data');
    expect(call.checkSlot).toBe('backfill-status:check');
    expect(call.runSlot).toBe('backfill-status:run');
  });

  it('renders this.dataTransform with placeholder(...) check/run slots', () => {
    const call = new DataTransformCall(
      'Backfill status',
      'backfill-status:check',
      'backfill-status:run',
    );
    const ts = call.renderTypeScript();
    expect(ts).toContain('this.dataTransform(endContract, "Backfill status", {');
    expect(ts).toContain('check: () => placeholder("backfill-status:check")');
    expect(ts).toContain('run: () => placeholder("backfill-status:run")');
  });

  it('renders the column a backfill fills, so its operation can name the rows it missed', () => {
    const call = new DataTransformCall(
      'backfill-user-title',
      'User.title:check',
      'User.title:run',
      'data',
      { schema: 'public', table: 'user', column: 'title' },
    );
    expect(call.renderTypeScript()).toBe(
      [
        'this.dataTransform(endContract, "backfill-user-title", {',
        '  backfillsColumn: { schema: "public", table: "user", column: "title" },',
        '  check: () => placeholder("User.title:check"),',
        '  run: () => placeholder("User.title:run"),',
        '})',
      ].join('\n'),
    );
  });

  it('importRequirements() references only the placeholder facade import (endContract comes from the scaffold)', () => {
    const call = new DataTransformCall('Backfill status', 'check', 'run');
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'placeholder' },
    ]);
  });
});

describe('EnableRowLevelSecurityCall', () => {
  it('lowers typed RLS-enabled checks and enables RLS via ALTER TABLE', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new EnableRowLevelSecurityCall('public', 'post');
    const op = await call.toOp(lowerer);

    const checks = rlsEnabledAst('public', 'post');
    expect(received).toEqual([checks.rlsDisabled(), checks.rlsEnabled()]);
    expect(op.execute).toEqual([
      {
        description: 'enable row-level security on "post"',
        sql: 'ALTER TABLE "public"."post" ENABLE ROW LEVEL SECURITY',
      },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(call.label).toBe('Enable row-level security on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new EnableRowLevelSecurityCall('public', 'post');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.enableRowLevelSecurity(...) with no facade import', () => {
    const call = new EnableRowLevelSecurityCall('public', 'post');
    expect(call.renderTypeScript()).toBe(
      'this.enableRowLevelSecurity({ schema: "public", table: "post" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DisableRowLevelSecurityCall', () => {
  it('lowers a typed DDL node and typed RLS-enabled checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DisableRowLevelSecurityCall('public', 'post');
    const op = await call.toOp(lowerer);

    expect(received).toHaveLength(3);
    expect(op.execute).toEqual([
      { description: 'disable row-level security on "post"', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 3', params: ['p3'] });
    expect(call.label).toBe('Disable row-level security on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DisableRowLevelSecurityCall('public', 'post');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.disableRowLevelSecurity(...) with no facade import', () => {
    const call = new DisableRowLevelSecurityCall('public', 'post');
    expect(call.renderTypeScript()).toBe(
      'this.disableRowLevelSecurity({ schema: "public", table: "post" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

function makePolicy(): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: parseNaming('post_owner_a1b2c3d4', 'post_owner'),
    tableName: 'post',
    namespaceId: 'public',
    operation: 'select',
    roles: ['authenticated'],
    using: 'author_id = current_user_id()',
    permissive: true,
    withCheck: undefined,
  });
}

describe('CreatePostgresRlsPolicyCall', () => {
  it('lowers a typed CREATE POLICY DDL node, a policy-absent precheck and a policy-definition postcheck', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const policy = makePolicy();
    const call = new CreatePostgresRlsPolicyCall('public', 'post', policy);
    const op = await call.toOp(lowerer);

    const checks = rlsPolicyExistsAst({
      schema: 'public',
      table: 'post',
      policyName: 'post_owner_a1b2c3d4',
    });
    expect(received[0]).toEqual(checks.policyAbsent());
    expect(received[2]).toEqual(
      rlsPolicyDefinitionAst({
        schema: 'public',
        table: 'post',
        policyName: 'post_owner_a1b2c3d4',
        command: 'SELECT',
        permissive: true,
        roles: ['authenticated'],
      }),
    );
    expect(op.execute).toEqual([
      {
        description: 'create RLS policy "post_owner_a1b2c3d4"',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 3', params: ['p3'] });
    expect(call.label).toBe('Create RLS policy "post_owner_a1b2c3d4" on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'post', makePolicy());
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders the full policy literal, omitting the absent withCheck key', () => {
    const call = new CreatePostgresRlsPolicyCall('public', 'post', makePolicy());
    expect(call.renderTypeScript()).toBe(
      [
        'this.createRlsPolicy({ schema: "public", table: "post", policy: {',
        '  naming: { kind: "wire", prefix: "post_owner", hash: "a1b2c3d4" },',
        '  tableName: "post",',
        '  namespaceId: "public",',
        '  operation: "select",',
        '  roles: ["authenticated"],',
        '  using: sql`author_id = current_user_id()`,',
        '  permissive: true,',
        '} })',
      ].join('\n'),
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'sql' },
    ]);
  });

  it('renders an exact policy literal as the exact naming arm', () => {
    const call = new CreatePostgresRlsPolicyCall(
      'public',
      'post',
      new PostgresRlsPolicy({
        naming: parseNaming('Tenant members can read', undefined),
        tableName: 'post',
        namespaceId: 'public',
        operation: 'select',
        roles: ['app_user'],
        using: '(tenant_id = 1)',
        withCheck: undefined,
        permissive: true,
      }),
    );
    expect(call.renderTypeScript()).toBe(
      [
        'this.createRlsPolicy({ schema: "public", table: "post", policy: {',
        '  naming: { kind: "exact", name: "Tenant members can read" },',
        '  tableName: "post",',
        '  namespaceId: "public",',
        '  operation: "select",',
        '  roles: ["app_user"],',
        '  using: sql`(tenant_id = 1)`,',
        '  permissive: true,',
        '} })',
      ].join('\n'),
    );
  });

  it('renders using and withCheck holding both quote kinds as sql templates', () => {
    const call = new CreatePostgresRlsPolicyCall(
      'public',
      'post',
      new PostgresRlsPolicy({
        naming: parseNaming('Members', undefined),
        tableName: 'post',
        namespaceId: 'public',
        operation: 'all',
        roles: ['app_user'],
        using: `"status" = 'published'`,
        withCheck: `"status" <> 'archived'`,
        permissive: false,
      }),
    );
    expect(call.renderTypeScript()).toBe(
      [
        'this.createRlsPolicy({ schema: "public", table: "post", policy: {',
        '  naming: { kind: "exact", name: "Members" },',
        '  tableName: "post",',
        '  namespaceId: "public",',
        '  operation: "all",',
        '  roles: ["app_user"],',
        '  using: sql`"status" = \'published\'`,',
        '  withCheck: sql`"status" <> \'archived\'`,',
        '  permissive: false,',
        '} })',
      ].join('\n'),
    );
  });
});

describe('DropPostgresRlsPolicyCall', () => {
  it('lowers a typed DROP POLICY DDL node and typed policy-existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropPostgresRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    const op = await call.toOp(lowerer);

    const checks = rlsPolicyExistsAst({
      schema: 'public',
      table: 'post',
      policyName: 'post_owner_a1b2c3d4',
    });
    expect(received[0]).toEqual(checks.policyPresent());
    expect(received[2]).toEqual(checks.policyAbsent());
    expect(op.execute).toEqual([
      { description: 'drop RLS policy "post_owner_a1b2c3d4"', sql: 'LOWERED 2', params: ['p2'] },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 3', params: ['p3'] });
    expect(call.label).toBe('Drop RLS policy "post_owner_a1b2c3d4" on "post"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropPostgresRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.dropRlsPolicy(...) with no facade import', () => {
    const call = new DropPostgresRlsPolicyCall('public', 'post', 'post_owner_a1b2c3d4');
    expect(call.renderTypeScript()).toBe(
      'this.dropRlsPolicy({ schema: "public", table: "post", policy: "post_owner_a1b2c3d4" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('RenamePostgresRlsPolicyCall', () => {
  it('lowers a typed ALTER POLICY RENAME DDL node and typed policy-existence checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new RenamePostgresRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    const op = await call.toOp(lowerer);

    const oldChecks = rlsPolicyExistsAst({
      schema: 'public',
      table: 'post',
      policyName: 'post_owner_a1b2c3d4',
    });
    const newChecks = rlsPolicyExistsAst({
      schema: 'public',
      table: 'post',
      policyName: 'post_owner_e5f6g7h8',
    });
    expect(received[0]).toEqual(oldChecks.policyPresent());
    expect(received[2]).toEqual(newChecks.policyPresent());
    expect(op.operationClass).toBe('widening');
    expect(op.execute).toEqual([
      {
        description: 'rename RLS policy "post_owner_a1b2c3d4" to "post_owner_e5f6g7h8"',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 3', params: ['p3'] });
    expect(call.label).toBe(
      'Rename RLS policy "post_owner_a1b2c3d4" to "post_owner_e5f6g7h8" on "post"',
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RenamePostgresRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renders this.renameRlsPolicy(...) with no facade import', () => {
    const call = new RenamePostgresRlsPolicyCall(
      'public',
      'post',
      'post_owner_a1b2c3d4',
      'post_owner_e5f6g7h8',
    );
    expect(call.renderTypeScript()).toBe(
      'this.renameRlsPolicy({ schema: "public", table: "post", from: "post_owner_a1b2c3d4", to: "post_owner_e5f6g7h8" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});
