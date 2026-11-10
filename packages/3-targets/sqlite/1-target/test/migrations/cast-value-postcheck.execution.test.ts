import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { storageClassCheck } from '../../src/core/migrations/operations/tables';

function holdsAfterCopy(typeSql: string, values: readonly string[]): boolean {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE "old" ("v")');
    db.exec(`INSERT INTO "old" ("v") VALUES ${values.map((value) => `(${value})`).join(', ')}`);
    db.exec(`CREATE TABLE "t" ("v" ${typeSql})`);
    db.exec('INSERT INTO "t" ("v") SELECT "v" FROM "old"');
    const check = storageClassCheck('t', { name: 'v', typeSql });
    return Object.values(db.prepare(check.sql).get() ?? {})[0] === 1;
  } finally {
    db.close();
  }
}

describe('storageClassCheck on SQLite', () => {
  it('holds when the copy converted every value, NULL included', () => {
    expect([
      holdsAfterCopy('INTEGER', [`'12'`, 'NULL', `'3.0'`]),
      holdsAfterCopy('REAL', [`'1.5'`, `'12'`, '7']),
      holdsAfterCopy('TEXT', ['12', '1.5', `'x'`]),
      holdsAfterCopy('NUMERIC', [`'1.5'`, `'2'`]),
      holdsAfterCopy('BLOB', [`X'00'`]),
    ]).toEqual([true, true, true, true, true]);
  });

  it('fails when a value kept its old storage class because the copy could not convert it', () => {
    expect([
      holdsAfterCopy('INTEGER', [`'12'`, `'abc'`]),
      holdsAfterCopy('INTEGER', [`'1.5'`]),
      holdsAfterCopy('REAL', [`'abc'`]),
      holdsAfterCopy('TEXT', [`X'00'`]),
      holdsAfterCopy('NUMERIC', [`'abc'`]),
      holdsAfterCopy('BLOB', [`'abc'`]),
    ]).toEqual([false, false, false, false, false, false]);
  });
});
