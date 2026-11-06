import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { checkExpression, col, fn } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import {
  columnExistsAst,
  columnTypeAst,
  constraintDefinitionAst,
  constraintExistsAst,
  relationKindAst,
  tableExistsAst,
} from '../../src/contract-free/checks';
import { addConstraintAction, alterTable } from '../../src/contract-free/ddl';
import { postgresDataTypes } from '../../src/core/data-types';
import {
  AddCheckConstraintCall,
  AddColumnWithTemporaryDefaultCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddRequiredColumnToEmptyTableCall,
  AddUniqueCall,
  CreateTableCall,
  DropCheckConstraintCall,
  DropConstraintCall,
} from '../../src/core/migrations/op-factory-call';

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

describe('CreateTableCall', () => {
  it('lowers typed to_regclass checks into parameterized pre/postcheck steps', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new CreateTableCall('public', 'user', [col('id', 'integer', { notNull: true })]);
    const op = await call.toOp(lowerer);

    expect(received.slice(1)).toEqual([
      tableExistsAst('public', 'user').tableAbsent(),
      relationKindAst({ schema: 'public', name: 'user', kinds: ['r', 'p'] }),
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure table "user" does not exist',
        expectation: { expects: 'absent', object: 'table "user"' },
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
    expect(op.execute).toEqual([
      { description: 'create table "user"', sql: 'LOWERED 1', params: ['p1'] },
    ]);
    expect(op.postcheck).toEqual([
      {
        description: 'verify table "user" exists',
        expectation: { expects: 'present', object: 'table "user"' },
        sql: 'LOWERED 3',
        params: ['p3'],
      },
    ]);
  });

  it('renders a default and a CHECK holding both quote kinds as sql templates', () => {
    const call = new CreateTableCall(
      'public',
      'user',
      [col('kind', 'text', { default: fn(`concat("prefix", 'user')`) })],
      [checkExpression('user_kind_check', `"kind" IN ('admin', 'user')`)],
    );
    expect(call.renderTypeScript()).toBe(
      'this.createTable({ schema: "public", table: "user", columns: [col("kind", "text", { default: fn(sql`concat("prefix", \'user\')`) })], constraints: [checkExpression("user_kind_check", sql`"kind" IN (\'admin\', \'user\')`)] })',
    );
    expect(call.importRequirements()).toContainEqual({
      moduleSpecifier: '@internal/postgres/migration',
      symbol: 'sql',
    });
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new CreateTableCall('public', 'user', [col('id', 'integer')]);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('toOp() without a lowerer reports MIGRATION.POSTGRES_CONTROL_STACK_MISSING', async () => {
    const call = new CreateTableCall('public', 'user', [col('id', 'integer')]);
    await expect(call.toOp()).rejects.toMatchObject({
      code: 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
      meta: { factory: 'CreateTableCall' },
    });
  });
});

const pkeyChecks = () =>
  constraintExistsAst({ constraintName: 'user_pkey', schema: 'public', table: 'user' });

describe('AddPrimaryKeyCall', () => {
  it('lowers typed constraint checks into parameterized pre/postcheck steps', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']);
    const op = await call.toOp(lowerer);

    expect(received).toEqual([
      pkeyChecks().constraintAbsent(),
      constraintDefinitionAst({
        schema: 'public',
        table: 'user',
        constraintName: 'user_pkey',
        contype: 'p',
        columns: ['id'],
      }),
    ]);
    expect(op.precheck).toEqual([
      {
        description: 'ensure primary key "user_pkey" does not exist',
        expectation: { expects: 'absent', object: 'primary key "user_pkey" on "user"' },
        sql: 'LOWERED 1',
        params: ['p1'],
      },
    ]);
    expect(op.execute[0]?.sql).toBe(
      'ALTER TABLE "public"."user" ADD CONSTRAINT "user_pkey" PRIMARY KEY ("id")',
    );
    expect(op.postcheck).toEqual([
      {
        description: 'verify primary key "user_pkey" exists on (id)',
        sql: 'LOWERED 2',
        params: ['p2'],
      },
    ]);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']);
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });

  it('renderTypeScript() emits this.addPrimaryKey with no facade import', () => {
    const call = new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']);
    expect(call.renderTypeScript()).toBe(
      'this.addPrimaryKey({ schema: "public", table: "user", constraint: "user_pkey", columns: ["id"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });

  it('renderTypeScript() omits schema for the unbound namespace', () => {
    const call = new AddPrimaryKeyCall('__unbound__', 'user', 'user_pkey', ['id']);
    expect(call.renderTypeScript()).toBe(
      'this.addPrimaryKey({ table: "user", constraint: "user_pkey", columns: ["id"] })',
    );
  });
});

describe('AddUniqueCall', () => {
  it('lowers typed checks and renders this.addUnique', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddUniqueCall('public', 'user', 'user_email_key', ['email']);
    const op = await call.toOp(lowerer);
    const checks = () =>
      constraintExistsAst({ constraintName: 'user_email_key', schema: 'public', table: 'user' });
    expect(received).toEqual([
      checks().constraintAbsent(),
      constraintDefinitionAst({
        schema: 'public',
        table: 'user',
        constraintName: 'user_email_key',
        contype: 'u',
        columns: ['email'],
      }),
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(call.renderTypeScript()).toBe(
      'this.addUnique({ schema: "public", table: "user", constraint: "user_email_key", columns: ["email"] })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AddForeignKeyCall', () => {
  it('lowers typed checks and renders this.addForeignKey', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const fk = {
      name: 'post_author_fk',
      columns: ['author_id'],
      references: { schema: 'public', table: 'user', columns: ['id'] },
    };
    const call = new AddForeignKeyCall('public', 'post', fk);
    const op = await call.toOp(lowerer);
    const checks = () =>
      constraintExistsAst({ constraintName: 'post_author_fk', schema: 'public', table: 'post' });
    expect(received).toEqual([
      checks().constraintAbsent(),
      constraintDefinitionAst({
        schema: 'public',
        table: 'post',
        constraintName: 'post_author_fk',
        contype: 'f',
        columns: ['author_id'],
        foreignKey: {
          referencedSchema: 'public',
          referencedTable: 'user',
          referencedColumns: ['id'],
          onDelete: 'a',
          onUpdate: 'a',
        },
      }),
    ]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.execute[0]?.sql).toContain('FOREIGN KEY ("author_id")');
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(call.renderTypeScript()).toContain('this.addForeignKey({ schema: "public"');
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('AddCheckConstraintCall', () => {
  it('lowers typed checks and renders this.addCheckConstraint', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddCheckConstraintCall(
      'public',
      'post',
      'post_priority_check',
      `"priority" IN ('low', 'high')`,
    );
    const op = await call.toOp(lowerer);
    const checks = () =>
      constraintExistsAst({
        constraintName: 'post_priority_check',
        schema: 'public',
        table: 'post',
      });
    expect(received).toEqual([
      checks().constraintAbsent(),
      constraintDefinitionAst({
        schema: 'public',
        table: 'post',
        constraintName: 'post_priority_check',
        contype: 'c',
      }),
      alterTable({
        schema: 'public',
        table: 'post',
        actions: [
          addConstraintAction(
            checkExpression('post_priority_check', `"priority" IN ('low', 'high')`),
          ),
        ],
      }),
    ]);
    expect(op.execute[0]?.sql).toBe('LOWERED 3');
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(call.renderTypeScript()).toBe(
      'this.addCheckConstraint({ schema: "public", table: "post", constraint: "post_priority_check", expression: sql`"priority" IN (\'low\', \'high\')` })',
    );
    expect(call.importRequirements()).toEqual([
      { moduleSpecifier: '@internal/postgres/migration', symbol: 'sql' },
    ]);
  });
});

describe('DropCheckConstraintCall', () => {
  it('lowers typed checks (present precheck, absent postcheck)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropCheckConstraintCall('public', 'post', 'post_priority_check');
    const op = await call.toOp(lowerer);
    const checks = () =>
      constraintExistsAst({
        constraintName: 'post_priority_check',
        schema: 'public',
        table: 'post',
      });
    expect(received).toEqual([checks().constraintAbsent(), checks().constraintPresent()]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(call.renderTypeScript()).toBe(
      'this.dropCheckConstraint({ schema: "public", table: "post", constraint: "post_priority_check" })',
    );
    expect(call.importRequirements()).toEqual([]);
  });
});

describe('DropConstraintCall', () => {
  it('lowers typed checks (present precheck, absent postcheck)', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new DropConstraintCall('public', 'user', 'user_email_key');
    const op = await call.toOp(lowerer);
    const checks = () =>
      constraintExistsAst({ constraintName: 'user_email_key', schema: 'public', table: 'user' });
    expect(received).toEqual([checks().constraintAbsent(), checks().constraintPresent()]);
    expect(op.precheck[0]).toMatchObject({ sql: 'LOWERED 2', params: ['p2'] });
    expect(op.postcheck[0]).toMatchObject({ sql: 'LOWERED 1', params: ['p1'] });
    expect(op.execute[0]?.sql).toBe('ALTER TABLE "public"."user" DROP CONSTRAINT "user_email_key"');
  });

  it('renders this.dropConstraint and includes kind only when non-default', () => {
    expect(new DropConstraintCall('public', 'user', 'user_email_key').renderTypeScript()).toBe(
      'this.dropConstraint({ schema: "public", table: "user", constraint: "user_email_key" })',
    );
    expect(
      new DropConstraintCall('public', 'user', 'user_org_fk', 'foreignKey').renderTypeScript(),
    ).toBe(
      'this.dropConstraint({ schema: "public", table: "user", constraint: "user_org_fk", kind: "foreignKey" })',
    );
  });
});

function isAlterTableNode(value: unknown): value is { kind: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'alter-table'
  );
}

describe('AddRequiredColumnToEmptyTableCall', () => {
  it('lowers a typed AlterTable DDL node for the ADD COLUMN execute step', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddRequiredColumnToEmptyTableCall(
      'public',
      'user',
      'name',
      'text',
      postgresDataTypes,
    );
    const op = await call.toOp(lowerer);

    expect(isAlterTableNode(received[0])).toBe(true);
    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'name' });
    expect(received).toContainEqual(colChecks.columnAbsent());
    expect(received).toContainEqual(colChecks.columnPresent());
    expect(received).toContainEqual(
      columnTypeAst({ schema: 'public', table: 'user', column: 'name', expectedType: 'text' }),
    );

    expect(op.execute).toEqual([{ description: 'add column "name"', sql: 'LOWERED 1' }]);
    expect(op.precheck).toHaveLength(2);
    expect(op.postcheck).toHaveLength(3);
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddRequiredColumnToEmptyTableCall(
      'public',
      'user',
      'name',
      'text',
      postgresDataTypes,
    );
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });
});

describe('the NOT NULL add-column calls', () => {
  it('render as migration methods with the column and, for the temporary default, its SQL', () => {
    expect([
      new AddRequiredColumnToEmptyTableCall(
        'public',
        'user',
        'name',
        'text',
        postgresDataTypes,
      ).renderTypeScript(),
      new AddColumnWithTemporaryDefaultCall(
        'public',
        'user',
        'name',
        'text',
        "''",
        postgresDataTypes,
      ).renderTypeScript(),
    ]).toEqual([
      'this.addRequiredColumnToEmptyTable({ schema: "public", table: "user", column: "name", type: "text" })',
      'this.addColumnWithTemporaryDefault({ schema: "public", table: "user", column: "name", type: "text", temporaryDefault: sql`\'\'` })',
    ]);
  });

  it('refuses an unsafe temporary default, naming the call', () => {
    expect(
      () =>
        new AddColumnWithTemporaryDefaultCall(
          'public',
          'user',
          'name',
          'text',
          "''; DROP TABLE x",
          postgresDataTypes,
        ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message: expect.stringContaining(
          'addColumnWithTemporaryDefault({ schema: "public", table: "user", column: "name" }): temporaryDefault',
        ),
      }),
    );
  });
});

describe('AddColumnWithTemporaryDefaultCall', () => {
  it('lowers a typed AlterTable DDL node for the ADD COLUMN execute step', async () => {
    const { lowerer, received } = recordingCheckLowerer();
    const call = new AddColumnWithTemporaryDefaultCall(
      'public',
      'user',
      'name',
      'text',
      "''",
      postgresDataTypes,
    );
    const op = await call.toOp(lowerer);

    expect(isAlterTableNode(received[0])).toBe(true);
    const colChecks = columnExistsAst({ schema: 'public', table: 'user', column: 'name' });
    expect(received).toContainEqual(colChecks.columnAbsent());

    expect(op.execute).toHaveLength(2);
    expect(op.execute[0]?.description).toBe('add column "name"');
    expect(op.execute[1]?.description).toContain('drop temporary default');
    expect(op.precheck).toHaveLength(1);
    expect(op.postcheck).toHaveLength(4);
    expect(received).toContainEqual(
      columnTypeAst({ schema: 'public', table: 'user', column: 'name', expectedType: 'text' }),
    );
  });

  it('toOp() throws when no lowerer is provided', async () => {
    const call = new AddColumnWithTemporaryDefaultCall(
      'public',
      'user',
      'name',
      'text',
      "''",
      postgresDataTypes,
    );
    await expect(async () => call.toOp()).rejects.toThrow('createPostgresMigrationPlanner');
  });
});
