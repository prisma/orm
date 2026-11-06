import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { DdlColumn, PrimaryKeyConstraint } from '@internal/sql-relational-core/ast';
import {
  AddColumnCall,
  CreateIndexCall,
  CreateTableCall,
} from '@internal/target-sqlite/op-factory-call';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { controlAdapter } from './fixtures/runner-fixtures';

function postchecksHold(setupSql: readonly string[], op: SqlMigrationPlanOperation<unknown>) {
  const db = new DatabaseSync(':memory:');
  try {
    for (const sql of setupSql) db.exec(sql);
    return op.postcheck.every((check) => {
      const row = db
        .prepare(check.sql)
        .get(...blindCast<SQLInputValue[], 'check params are text'>(check.params ?? []));
      return Object.values(row ?? {})[0] === 1;
    });
  } finally {
    db.close();
  }
}

function executeSql(op: SqlMigrationPlanOperation<unknown>): string[] {
  return op.execute.map((step) => step.sql);
}

describe('createTable postchecks on SQLite', () => {
  const userTable = () =>
    new CreateTableCall(
      'User',
      [
        new DdlColumn({ name: 'id', type: 'INTEGER', notNull: true }),
        new DdlColumn({ name: 'email', type: 'TEXT', notNull: true }),
        new DdlColumn({ name: 'nickname', type: 'TEXT' }),
      ],
      [new PrimaryKeyConstraint({ columns: ['id'] })],
    ).toOp(controlAdapter);

  it('hold once the table exists as the operation creates it', async () => {
    const op = await userTable();

    expect(postchecksHold(executeSql(op), op)).toBe(true);
  });

  it('fail while a table of that name has other columns', async () => {
    const op = await userTable();

    expect([
      postchecksHold(['CREATE TABLE "User" ("id" INTEGER NOT NULL, PRIMARY KEY ("id"))'], op),
      postchecksHold(
        [
          'CREATE TABLE "User" ("id" INTEGER NOT NULL, "email" INTEGER NOT NULL, "nickname" TEXT, PRIMARY KEY ("id"))',
        ],
        op,
      ),
      postchecksHold(
        [
          'CREATE TABLE "User" ("id" INTEGER NOT NULL, "email" TEXT, "nickname" TEXT, PRIMARY KEY ("id"))',
        ],
        op,
      ),
      postchecksHold(
        ['CREATE TABLE "User" ("id" INTEGER NOT NULL, "email" TEXT NOT NULL, "nickname" TEXT)'],
        op,
      ),
      postchecksHold(
        [
          'CREATE TABLE "User" ("id" INTEGER NOT NULL, "email" TEXT NOT NULL, "nickname" TEXT, "extra" TEXT, PRIMARY KEY ("id"))',
        ],
        op,
      ),
    ]).toEqual([false, false, false, false, false]);
  });

  it('hold for an autoincrement primary key the operation creates', async () => {
    const op = await new CreateTableCall('Counter', [
      new DdlColumn({ name: 'id', type: 'INTEGER PRIMARY KEY AUTOINCREMENT' }),
    ]).toOp(controlAdapter);

    expect([
      postchecksHold(executeSql(op), op),
      postchecksHold(['CREATE TABLE "Counter" ("id" TEXT)'], op),
    ]).toEqual([true, false]);
  });
});

describe('addColumn postchecks on SQLite', () => {
  const addEmail = () =>
    new AddColumnCall('User', { name: 'email', typeSql: 'TEXT', nullable: false }).toOp(
      controlAdapter,
    );
  const userTable = 'CREATE TABLE "User" ("id" INTEGER NOT NULL, PRIMARY KEY ("id"))';

  it('hold once the column exists as the operation adds it', async () => {
    const op = await addEmail();

    expect(postchecksHold([userTable, ...executeSql(op)], op)).toBe(true);
  });

  it('fail while a column of that name has another type or nullability', async () => {
    const op = await addEmail();

    expect([
      postchecksHold(
        [userTable, `ALTER TABLE "User" ADD COLUMN "email" INTEGER NOT NULL DEFAULT 0`],
        op,
      ),
      postchecksHold([userTable, `ALTER TABLE "User" ADD COLUMN "email" TEXT`], op),
    ]).toEqual([false, false]);
  });
});

describe('createIndex postchecks on SQLite', () => {
  const tables = [
    'CREATE TABLE "User" ("id" INTEGER NOT NULL, "a" TEXT, "b" TEXT, PRIMARY KEY ("id"))',
    'CREATE TABLE "Other" ("id" INTEGER NOT NULL, "a" TEXT, "b" TEXT, PRIMARY KEY ("id"))',
  ];
  const createIndex = () =>
    new CreateIndexCall('User', 'User_a_b_idx', ['a', 'b']).toOp(controlAdapter);

  it('hold once the index exists as the operation creates it', async () => {
    const op = await createIndex();

    expect(postchecksHold([...tables, ...executeSql(op)], op)).toBe(true);
  });

  it('fail while an index of that name has another definition', async () => {
    const op = await createIndex();

    expect([
      postchecksHold([...tables, 'CREATE INDEX "User_a_b_idx" ON "User" ("b", "a")'], op),
      postchecksHold([...tables, 'CREATE INDEX "User_a_b_idx" ON "User" ("a")'], op),
      postchecksHold([...tables, 'CREATE INDEX "User_a_b_idx" ON "Other" ("a", "b")'], op),
      postchecksHold([...tables, 'CREATE UNIQUE INDEX "User_a_b_idx" ON "User" ("a", "b")'], op),
    ]).toEqual([false, false, false, false]);
  });
});
