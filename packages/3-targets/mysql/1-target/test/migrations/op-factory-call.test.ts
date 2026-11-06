import type { ControlStack } from '@internal/framework-components/control';
import { ForeignKeyConstraint } from '@internal/sql-relational-core/ast';
import { col, fn, lit, primaryKey, unique } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { MysqlMigration } from '../../src/core/migrations/mysql-migration';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreateTableCall,
  DropColumnCall,
  DropForeignKeyCall,
  DropIndexCall,
  DropTableCall,
  DropUniqueCall,
  RawSqlCall,
  renameTableByHandOp,
} from '../../src/core/migrations/op-factory-call';
import { rawSql } from '../../src/core/migrations/operations';
import { renderOps } from '../../src/core/migrations/render-ops';
import { stubLowerer } from './fixtures';

const IN_DATABASE = 'TABLE_SCHEMA = DATABASE()';

describe('MySQL migration calls', () => {
  it('drop a table with checks that the table is there before and gone after', () => {
    expect(new DropTableCall('Legacy').toOp()).toEqual({
      id: 'dropTable.Legacy',
      label: 'Drop table Legacy',
      summary: 'Drops table Legacy which is not in the contract',
      operationClass: 'destructive',
      target: { id: 'mysql', details: { objectType: 'table', name: 'Legacy' } },
      precheck: [
        {
          description: 'ensure table "Legacy" exists',
          sql: `SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE ${IN_DATABASE} AND TABLE_NAME = ?) > 0 AS result`,
          params: ['Legacy'],
          expectation: { expects: 'present', object: 'table "Legacy"' },
        },
      ],
      execute: [{ description: 'drop table "Legacy"', sql: 'DROP TABLE `Legacy`' }],
      postcheck: [
        {
          description: 'verify table "Legacy" is gone',
          sql: `SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE ${IN_DATABASE} AND TABLE_NAME = ?) = 0 AS result`,
          params: ['Legacy'],
          expectation: { expects: 'absent', object: 'table "Legacy"' },
        },
      ],
    });
  });

  it('check columns, indexes and constraints in information_schema', () => {
    const checksOf = (op: { precheck: readonly { sql: string; params?: readonly unknown[] }[] }) =>
      op.precheck.map(({ sql, params }) => ({ from: sql.split(' WHERE ')[0], params }));
    expect({
      column: checksOf(new DropColumnCall('User', 'nickname').toOp()),
      index: checksOf(new DropIndexCall('User', 'User_email_idx').toOp()),
      unique: checksOf(new DropUniqueCall('User', 'User_email_key').toOp()),
      foreignKey: checksOf(new DropForeignKeyCall('Post', 'Post_authorId_fkey').toOp()),
    }).toEqual({
      column: [
        {
          from: 'SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS',
          params: ['User', 'nickname'],
        },
      ],
      index: [
        {
          from: 'SELECT (SELECT COUNT(*) FROM information_schema.STATISTICS',
          params: ['User', 'User_email_idx'],
        },
      ],
      unique: [
        {
          from: 'SELECT (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS',
          params: ['User', 'User_email_key', 'UNIQUE'],
        },
      ],
      foreignKey: [
        {
          from: 'SELECT (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS',
          params: ['Post', 'Post_authorId_fkey', 'FOREIGN KEY'],
        },
      ],
    });
  });

  it('write themselves as calls of the MySQL migration class', () => {
    const calls = [
      new CreateTableCall(
        'User',
        [
          col('id', 'int', { notNull: true, default: fn('autoincrement()') }),
          col('name', 'varchar(191)', { default: lit('anon') }),
        ],
        [primaryKey(['id']), unique(['name'], { name: 'User_name_key' })],
      ),
      new AddColumnCall('User', col('age', 'int')),
      new DropColumnCall('User', 'age'),
      new CreateIndexCall('User', 'User_name_idx', ['name'], false),
      new DropIndexCall('User', 'User_name_idx'),
      new AddUniqueCall('User', 'User_name_key', ['name']),
      new DropUniqueCall('User', 'User_name_key'),
      new AddForeignKeyCall('Post', {
        name: 'Post_authorId_fkey',
        columns: ['authorId'],
        references: { table: 'User', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'restrict',
      }),
      new DropForeignKeyCall('Post', 'Post_authorId_fkey'),
      new DropTableCall('User'),
    ];
    expect({
      source: calls.map((call) => call.renderTypeScript()),
      imports: [
        ...new Set(calls.flatMap((call) => call.importRequirements().map((i) => i.symbol))),
      ],
    }).toEqual({
      source: [
        'this.createTable({ table: "User", columns: [col("id", "int", { notNull: true, default: fn(sql`autoincrement()`) }), col("name", "varchar(191)", { default: lit("anon") })], constraints: [primaryKey(["id"]), unique(["name"], { name: "User_name_key" })] })',
        'this.addColumn({ table: "User", column: col("age", "int") })',
        'this.dropColumn({ table: "User", column: "age" })',
        'this.createIndex({ table: "User", index: "User_name_idx", columns: ["name"] })',
        'this.dropIndex({ table: "User", index: "User_name_idx" })',
        'this.addUnique({ table: "User", name: "User_name_key", columns: ["name"] })',
        'this.dropUnique({ table: "User", name: "User_name_key" })',
        'this.addForeignKey({ table: "Post", name: "Post_authorId_fkey", columns: ["authorId"], references: { table: "User", columns: ["id"] }, onDelete: "cascade", onUpdate: "restrict" })',
        'this.dropForeignKey({ table: "Post", name: "Post_authorId_fkey" })',
        'this.dropTable({ table: "User" })',
      ],
      imports: ['col', 'fn', 'lit', 'primaryKey', 'unique', 'sql'],
    });
  });

  it('refuses to write a foreign key into createTable', () => {
    const call = new CreateTableCall(
      'Post',
      [col('authorId', 'int')],
      [
        new ForeignKeyConstraint({
          columns: ['authorId'],
          refTable: 'User',
          refColumns: ['id'],
          name: 'fk',
        }),
      ],
    );
    expect(() => call.renderTypeScript()).toThrow(/addForeignKey/);
  });

  it('need the control adapter to write a table or a column', async () => {
    await expect(new CreateTableCall('User', [], []).toOp()).rejects.toMatchObject({
      code: 'MIGRATION.MYSQL_CONTROL_STACK_MISSING',
    });
    await expect(new AddColumnCall('User', col('age', 'int')).toOp()).rejects.toMatchObject({
      code: 'MIGRATION.MYSQL_CONTROL_STACK_MISSING',
    });
  });

  it('carry a table rename written by hand as a raw operation', () => {
    const op = renameTableByHandOp('Old', 'New');
    const call = new RawSqlCall(op);
    expect({
      execute: op.execute.map(({ sql }) => sql),
      raw: rawSql(op) === op,
      toOp: call.toOp() === op,
      source: call.renderTypeScript().startsWith('rawSql({'),
      imports: call.importRequirements().map(({ symbol }) => symbol),
    }).toEqual({
      execute: ['RENAME TABLE `Old` TO `New`'],
      raw: true,
      toOp: true,
      source: true,
      imports: ['rawSql'],
    });
  });
});

describe('renderOps', () => {
  it('lowers every call, and refuses an operation built for another target', async () => {
    const foreign = {
      factoryName: 'foreign',
      operationClass: 'additive',
      label: 'Foreign',
      toOp: () => ({ ...new DropTableCall('x').toOp(), target: { id: 'postgres' } }),
      renderTypeScript: () => '',
      importRequirements: () => [],
    };
    const lowered = renderOps(
      [new DropTableCall('x'), new AddColumnCall('x', col('a', 'int'))],
      stubLowerer,
    );
    expect((await Promise.all(lowered)).map(({ id }) => id)).toEqual(['dropTable.x', 'column.x.a']);
    expect(() => renderOps([foreign as never])).toThrow(/expected a mysql operation/);
  });
});

class Example extends MysqlMigration {
  override get operations() {
    return [
      this.createTable({ table: 'T', columns: [col('id', 'int', { notNull: true })] }),
      this.dropTable({ table: 'T' }),
      this.addColumn({ table: 'T', column: col('a', 'int') }),
      this.dropColumn({ table: 'T', column: 'a' }),
      this.createIndex({ table: 'T', index: 'T_a_idx', columns: ['a'], unique: true }),
      this.dropIndex({ table: 'T', index: 'T_a_idx' }),
      this.addUnique({ table: 'T', name: 'T_a_key', columns: ['a'] }),
      this.dropUnique({ table: 'T', name: 'T_a_key' }),
      this.addForeignKey({
        table: 'T',
        name: 'T_a_fkey',
        columns: ['a'],
        references: { table: 'U', columns: ['id'] },
        onDelete: 'setNull',
      }),
      this.dropForeignKey({ table: 'T', name: 'T_a_fkey' }),
    ];
  }
}

describe('MysqlMigration', () => {
  it('writes each operation through the control adapter of its stack', async () => {
    const stack = { adapter: { create: () => stubLowerer } } as unknown as ControlStack<
      'sql',
      'mysql'
    >;
    const operations = await Promise.all(new Example(stack).operations);
    expect(operations.map(({ id, execute }) => [id, execute[0]?.sql])).toEqual([
      ['table.T', 'create-table T'],
      ['dropTable.T', 'DROP TABLE `T`'],
      ['column.T.a', 'ALTER TABLE `T` ADD COLUMN `a` int'],
      ['dropColumn.T.a', 'ALTER TABLE `T` DROP COLUMN `a`'],
      ['index.T.T_a_idx', 'CREATE UNIQUE INDEX `T_a_idx` ON `T` (`a`)'],
      ['dropIndex.T.T_a_idx', 'DROP INDEX `T_a_idx` ON `T`'],
      ['unique.T.T_a_key', 'ALTER TABLE `T` ADD CONSTRAINT `T_a_key` UNIQUE (`a`)'],
      ['dropUnique.T.T_a_key', 'ALTER TABLE `T` DROP INDEX `T_a_key`'],
      [
        'foreignKey.T.T_a_fkey',
        'ALTER TABLE `T` ADD CONSTRAINT `T_a_fkey` FOREIGN KEY (`a`) REFERENCES `U` (`id`) ON DELETE SET NULL',
      ],
      ['dropForeignKey.T.T_a_fkey', 'ALTER TABLE `T` DROP FOREIGN KEY `T_a_fkey`'],
    ]);
  });

  it('refuses to write a table without a control stack', () => {
    expect(() => new Example().operations).toThrow(
      expect.objectContaining({ code: 'MIGRATION.MYSQL_CONTROL_STACK_MISSING' }),
    );
  });
});
