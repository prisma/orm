import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { DdlColumn, LiteralColumnDefault } from '@internal/sql-relational-core/ast';
import { col, lit, primaryKey } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { columnExistsAst } from '../../src/contract-free/checks';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropIndexCall,
  DropTableCall,
  RecreateTableCall,
} from '../../src/core/migrations/op-factory-call';
import type {
  SqliteColumnSpec,
  SqliteTableSpec,
} from '../../src/core/migrations/operations/shared';

function stubLowerer(sql: string): ExecuteRequestLowerer {
  return {
    lower: () => Object.freeze({ sql, params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async () => Object.freeze({ sql, params: Object.freeze([]) }),
  };
}

function colSpec(overrides: Partial<SqliteColumnSpec> = {}): SqliteColumnSpec {
  return {
    name: 'col',
    typeSql: 'TEXT',
    nullable: true,
    ...overrides,
  };
}

function tableSpec(
  columns: SqliteColumnSpec[],
  overrides: Partial<SqliteTableSpec> = {},
): SqliteTableSpec {
  return {
    columns,
    uniques: [],
    foreignKeys: [],
    ...overrides,
  };
}

describe('CreateTableCall', () => {
  it('produces an additive op with correct id, label, and execute/pre/postcheck shape', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateTableCall(
      'user',
      [col('id', 'INTEGER', { notNull: true }), col('email', 'TEXT', { notNull: true })],
      [primaryKey(['id'])],
    );
    expect(call.factoryName).toBe('createTable');
    expect(call.operationClass).toBe('additive');
    expect(call.label).toBe('Create table user');

    const op = await call.toOp(lowerer);
    expect(op.id).toBe('table.user');
    expect(op.label).toBe('Create table user');
    expect(received).toHaveLength(3);
    expect(op.precheck).toHaveLength(1);
    expect(op.execute).toHaveLength(1);
    expect(op.postcheck).toHaveLength(1);
  });

  it('lowers DDL + two typed check ASTs via lowerToExecuteRequest', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateTableCall('user', [col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT')]);
    await call.toOp(lowerer);
    expect(received).toHaveLength(3);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateTableCall('user', [col('id', 'INTEGER', { notNull: true })]);
    await expect(call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });

  it('renderTypeScript() emits a this.createTable({...}) expression with col() calls', () => {
    const call = new CreateTableCall('user', [col('id', 'INTEGER', { notNull: true })]);
    const ts = call.renderTypeScript();
    expect(ts).toMatch(/^this\.createTable\(/);
    expect(ts).toContain('col("id", "INTEGER"');
  });

  it('renderTypeScript() writes each column codec, so the file reads its defaults with the codec', () => {
    const call = new CreateTableCall('note', [
      col('at', 'TEXT', {
        notNull: true,
        default: lit('2020-01-01T00:00:00Z'),
        codecRef: { codecId: 'sqlite/datetime@1' },
      }),
    ]);
    expect(call.renderTypeScript()).toBe(
      'this.createTable({ table: "note", columns: [col("at", "TEXT", { notNull: true, default: lit("2020-01-01T00:00:00Z"), codecRef: { codecId: "sqlite/datetime@1" } })] })',
    );
  });

  it('importRequirements() includes col from the migration module', () => {
    const call = new CreateTableCall('user', [col('id', 'INTEGER')]);
    const reqs = call.importRequirements();
    expect(reqs).toContainEqual({
      moduleSpecifier: '@internal/sqlite/migration',
      symbol: 'col',
    });
  });
});

describe('DropTableCall', () => {
  it('produces a destructive op with DROP TABLE', async () => {
    const lowerer = stubLowerer('CHECK SQL');
    const call = new DropTableCall('orphan');
    expect(call.factoryName).toBe('dropTable');
    expect(call.operationClass).toBe('destructive');
    expect(call.label).toBe('Drop table orphan');

    const op = await call.toOp(lowerer);
    expect(op.id).toBe('dropTable.orphan');
    expect(op.execute[0]?.sql).toBe('DROP TABLE "orphan"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropTableCall('orphan');
    await expect(call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });

  it('renderTypeScript() emits this.dropTable({...})', () => {
    expect(new DropTableCall('orphan').renderTypeScript()).toBe(
      'this.dropTable({ table: "orphan" })',
    );
  });
});

function recordingCheckLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED CHECK ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

describe('AddColumnCall', () => {
  it('produces an additive op with ALTER TABLE ADD COLUMN and lowered typed checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddColumnCall(
      'user',
      colSpec({ name: 'bio', typeSql: 'TEXT', nullable: true }),
    );
    expect(call.factoryName).toBe('addColumn');
    expect(call.operationClass).toBe('additive');

    const op = await call.toOp(lowerer);
    expect(op.id).toBe('column.user.bio');
    expect(op.execute[0]?.sql).toContain('ALTER TABLE "user"');
    expect(op.execute[0]?.sql).toContain('ADD COLUMN "bio" TEXT');

    expect(received).toEqual([
      columnExistsAst('user', 'bio').columnAbsent(),
      columnExistsAst('user', 'bio').columnPresent(),
    ]);
    expect(op.precheck).toEqual([
      { description: 'ensure column "bio" is missing', sql: 'LOWERED CHECK 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      { description: 'verify column "bio" exists', sql: 'LOWERED CHECK 2', params: ['p2'] },
    ]);
  });

  it('writes the default clause the adapter renders for the column, and NOT NULL', async () => {
    const rendered: unknown[] = [];
    const lowerer: ExecuteRequestLowerer = {
      ...recordingCheckLowerer().lowerer,
      renderColumnDefault: async (column, table) => {
        rendered.push({ column, table });
        return "DEFAULT 'user'";
      },
    };
    const call = new AddColumnCall(
      'user',
      colSpec({
        name: 'role',
        typeSql: 'TEXT',
        default: { kind: 'literal', value: 'user' },
        codecRef: { codecId: 'sqlite/text@1' },
        nullable: false,
      }),
    );
    const op = await call.toOp(lowerer);
    expect({ rendered, sql: op.execute[0]?.sql }).toEqual({
      rendered: [
        {
          table: 'user',
          column: new DdlColumn({
            name: 'role',
            type: 'TEXT',
            default: new LiteralColumnDefault('user'),
            codecRef: { codecId: 'sqlite/text@1' },
          }),
        },
      ],
      sql: `ALTER TABLE "user" ADD COLUMN "role" TEXT DEFAULT 'user' NOT NULL`,
    });
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddColumnCall('user', colSpec({ name: 'bio' }));
    await expect(async () => call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });
});

describe('a column spec an earlier version wrote', () => {
  const earlier = {
    name: 'added',
    typeSql: 'TEXT',
    defaultSql: "DEFAULT 'new'",
    nullable: false,
  };
  const refusal = (operation: string) =>
    expect.objectContaining({
      code: 'MIGRATION.OPERATION_OPTION_REMOVED',
      message: `\`${operation}\` in migration.ts passes \`defaultSql\`, which this version no longer reads, for column "added" of table "Note"`,
      fix: "Write the column's default as `default: { kind: 'literal', value }` or `default: { kind: 'function', expression }`, with the column's `codecRef`, in place of `defaultSql`, and delete an empty `defaultSql`. Or, if the migration is not applied, delete its package and run `migration plan` again. The upgrade entry `migration-ts-column-defaults` shows the new shape: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading",
      meta: {
        operation,
        option: 'defaultSql',
        upgradeEntry: 'migration-ts-column-defaults',
      },
    });

  it('is refused by addColumn', async () => {
    await expect(new AddColumnCall('Note', earlier).toOp(stubLowerer('SQL'))).rejects.toThrow(
      refusal('addColumn'),
    );
  });

  it('is refused by recreateTable, even with an empty defaultSql', async () => {
    const emptyDefault = { ...earlier, defaultSql: '' };
    const call = new RecreateTableCall({
      tableName: 'Note',
      contractTable: tableSpec([colSpec({ name: 'id' }), emptyDefault]),
      schemaColumnNames: ['id'],
      indexes: [],
      summary: 'Rebuild Note',
      postchecks: [],
      operationClass: 'widening',
    });
    await expect(call.toOp(stubLowerer('SQL'))).rejects.toThrow(refusal('recreateTable'));
  });
});

describe('DropColumnCall', () => {
  it('produces a destructive op with ALTER TABLE DROP COLUMN and lowered typed checks', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropColumnCall('user', 'old');
    const op = await call.toOp(lowerer);
    expect(op.id).toBe('dropColumn.user.old');
    expect(op.operationClass).toBe('destructive');
    expect(op.execute[0]?.sql).toBe('ALTER TABLE "user" DROP COLUMN "old"');

    expect(received).toEqual([
      columnExistsAst('user', 'old').columnPresent(),
      columnExistsAst('user', 'old').columnAbsent(),
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure column "old" exists on "user"',
        sql: 'LOWERED CHECK 1',
        params: ['p1'],
      },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify column "old" is gone from "user"',
        sql: 'LOWERED CHECK 2',
        params: ['p2'],
      },
    ]);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropColumnCall('user', 'old');
    await expect(async () => call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });
});

describe('CreateIndexCall', () => {
  it('produces a CREATE INDEX op (same shape regardless of FK-backing origin)', async () => {
    const lowerer = stubLowerer('CHECK SQL');
    const call = new CreateIndexCall('user', 'idx_email', ['email']);
    expect(call.label).toBe('Create index idx_email on user');
    const op = await call.toOp(lowerer);
    expect(op.id).toBe('index.user.idx_email');
    expect(op.execute[0]?.description).toBe('create index "idx_email"');
    expect(op.execute[0]?.sql).toBe('CREATE INDEX "idx_email" ON "user" ("email")');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateIndexCall('user', 'idx_email', ['email']);
    await expect(call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });

  it('renderTypeScript() emits this.createIndex({...})', () => {
    const call = new CreateIndexCall('user', 'idx_email', ['email']);
    expect(call.renderTypeScript()).toBe(
      'this.createIndex({ table: "user", index: "idx_email", columns: ["email"] })',
    );
  });
});

describe('DropIndexCall', () => {
  it('produces a destructive DROP INDEX IF EXISTS op', async () => {
    const lowerer = stubLowerer('CHECK SQL');
    const call = new DropIndexCall('user', 'idx_email');
    const op = await call.toOp(lowerer);
    expect(op.id).toBe('dropIndex.user.idx_email');
    expect(op.operationClass).toBe('destructive');
    expect(op.execute[0]?.sql).toBe('DROP INDEX IF EXISTS "idx_email"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new DropIndexCall('user', 'idx_email');
    await expect(call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });

  it('renderTypeScript() emits this.dropIndex({...})', () => {
    const call = new DropIndexCall('user', 'idx_email');
    expect(call.renderTypeScript()).toBe('this.dropIndex({ table: "user", index: "idx_email" })');
  });
});

describe('RecreateTableCall', () => {
  it('produces a single op with the four core execute steps + index recreation', async () => {
    const lowerer = stubLowerer('CHECK SQL');
    const contractSpec = tableSpec(
      [
        colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
        colSpec({ name: 'email', typeSql: 'TEXT', nullable: false }),
      ],
      { primaryKey: { columns: ['id'] } },
    );

    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: contractSpec,
      schemaColumnNames: ['id', 'email'],
      indexes: [{ name: 'idx_email', columns: ['email'] }],
      summary: 'Recreates table user to apply schema changes: type mismatch on email',
      postchecks: [
        {
          description: 'verify "email" type on "user"',
          sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE name = 'email'",
        },
      ],
      operationClass: 'destructive',
    });

    expect(call.factoryName).toBe('recreateTable');
    const op = await call.toOp(lowerer);
    expect(op.id).toBe('recreateTable.user');
    expect(op.operationClass).toBe('destructive');
    expect(op.summary).toBe('Recreates table user to apply schema changes: type mismatch on email');

    const descriptions = op.execute.map((s) => s.description);
    expect(descriptions[0]).toContain('create new table "_prisma_new_user"');
    expect(descriptions[1]).toContain('copy data');
    expect(descriptions[2]).toContain('drop old table');
    expect(descriptions[3]).toContain('rename');
    expect(descriptions[4]).toContain('idx_email');

    expect(op.postcheck.some((s) => s.description.includes('type'))).toBe(true);
  });

  it('writes each column default the adapter renders, and checks the recreated table carries it', async () => {
    const lowerer: ExecuteRequestLowerer = {
      ...stubLowerer('CHECK SQL'),
      renderColumnDefault: async (column, table) =>
        column.default?.kind === 'literal'
          ? `DEFAULT '${String(column.default.value)}' /* ${table} */`
          : column.default?.kind === 'function'
            ? `DEFAULT (${column.default.expression})`
            : '',
    };
    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: tableSpec([
        colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
        colSpec({
          name: 'role',
          default: { kind: 'literal', value: 'member' },
          codecRef: { codecId: 'sqlite/text@1' },
        }),
        colSpec({ name: 'at', default: { kind: 'function', expression: "datetime('now')" } }),
      ]),
      schemaColumnNames: ['id', 'role', 'at'],
      indexes: [],
      summary: 'Recreates table user',
      postchecks: [
        { description: 'verify "role" default on "user"', columnDefault: 'role' },
        { description: 'verify "at" default on "user"', columnDefault: 'at' },
        { description: 'verify "id" default on "user"', columnDefault: 'id' },
      ],
      operationClass: 'widening',
    });

    const op = await call.toOp(lowerer);
    expect({
      create: op.execute[0]?.sql,
      defaultChecks: op.postcheck.slice(2),
    }).toEqual({
      create:
        'CREATE TABLE "_prisma_new_user" (\n  "id" INTEGER NOT NULL,\n  "role" TEXT DEFAULT \'member\' /* user */,\n  "at" TEXT DEFAULT (datetime(\'now\'))\n)',
      defaultChecks: [
        {
          description: 'verify "role" default on "user"',
          sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE name = 'role' AND dflt_value = '''member'' /* user */'",
        },
        {
          description: 'verify "at" default on "user"',
          sql: "SELECT COUNT(*) > 0 FROM pragma_table_info('user') WHERE name = 'at' AND dflt_value = 'datetime(''now'')'",
        },
      ],
    });
  });

  it('skips columns missing from the live schema in the data-copy column list', async () => {
    const lowerer = stubLowerer('CHECK SQL');
    const contractSpec = tableSpec(
      [
        colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false }),
        colSpec({ name: 'old_col', typeSql: 'TEXT', nullable: true }),
        colSpec({ name: 'new_col', typeSql: 'TEXT', nullable: true }),
      ],
      { primaryKey: { columns: ['id'] } },
    );

    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: contractSpec,
      schemaColumnNames: ['id', 'old_col'],
      indexes: [],
      summary: 'Recreates table user',
      postchecks: [],
      operationClass: 'widening',
    });

    const op = await call.toOp(lowerer);
    const copyStep = op.execute.find((s) => s.description.startsWith('copy data'));
    expect(copyStep?.sql).toContain('"id", "old_col"');
    expect(copyStep?.sql).not.toContain('"new_col"');
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new RecreateTableCall({
      tableName: 'user',
      contractTable: tableSpec([colSpec({ name: 'id', typeSql: 'INTEGER', nullable: false })]),
      schemaColumnNames: ['id'],
      indexes: [],
      summary: 'Recreates table user',
      postchecks: [],
      operationClass: 'widening',
    });
    await expect(call.toOp()).rejects.toThrow('createSqliteMigrationPlanner');
  });
});

describe('dataTransform factory (user-authored)', () => {
  it('produces a class="data" op with execute step from the run closure', async () => {
    const { dataTransform } = await import('../../src/core/migrations/operations/data-transform');
    const op = dataTransform({
      id: 'data_migration.backfill-user-email',
      label: 'Backfill user.email',
      table: 'user',
      description: 'fill nulls',
      run: () => 'UPDATE "user" SET email = \'\' WHERE email IS NULL',
    });

    expect(op.id).toBe('data_migration.backfill-user-email');
    expect(op.label).toBe('Backfill user.email');
    expect(op.operationClass).toBe('data');
    expect(op.precheck).toEqual([]);
    expect(op.postcheck).toEqual([]);
    expect(op.execute).toEqual([
      { description: 'fill nulls', sql: 'UPDATE "user" SET email = \'\' WHERE email IS NULL' },
    ]);
    expect(op.target.details).toEqual({ schema: 'main', objectType: 'table', name: 'user' });
  });
});

describe('DataTransformCall', () => {
  const makeCall = () =>
    new DataTransformCall(
      'data_migration.backfill-user-email',
      'Backfill NULLs in "user"."email" before NOT NULL tightening',
      'user',
      'email',
    );

  it('toOp() throws MIGRATION.UNFILLED_PLACEHOLDER (unfilled placeholder)', () => {
    expect(() => makeCall().toOp()).toThrowError(/MIGRATION.UNFILLED_PLACEHOLDER|unfilled/i);
  });

  it('renderTypeScript() emits a dataTransform({...}) call with a placeholder run slot', () => {
    const ts = makeCall().renderTypeScript();
    expect(ts).toContain('dataTransform({');
    expect(ts).toContain('placeholder("user-email-backfill-sql")');
    expect(ts).toContain('"data_migration.backfill-user-email"');
  });

  it('importRequirements() pulls dataTransform + placeholder from the migration module', () => {
    const reqs = makeCall().importRequirements();
    expect(reqs).toEqual([
      { moduleSpecifier: '@internal/sqlite/migration', symbol: 'dataTransform' },
      { moduleSpecifier: '@internal/sqlite/migration', symbol: 'placeholder' },
    ]);
  });
});
