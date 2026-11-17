import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, wasClosedByDriver } from '../src/database-state';
import { normalizeSqliteError } from '../src/normalize-error';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-normalize-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('normalizeSqliteError', () => {
  it('classifies a database that cannot be opened as a non-transient connection error', () => {
    const cause = thrownBy(() => new DatabaseSync(join(testDir, 'missing-dir', 'test.db')));

    expect(cause).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 14 });
    expect(normalizeSqliteError(cause, false)).toMatchObject({
      kind: 'sql_connection',
      transient: false,
      cause,
    });
  });

  it('classifies a file that is not a database as a non-transient connection error', () => {
    const path = join(testDir, 'not-a-database.db');
    writeFileSync(path, 'x'.repeat(512));
    const cause = thrownBy(() => new DatabaseSync(path).exec('select * from sqlite_master'));

    expect(cause).toMatchObject({ code: 'ERR_SQLITE_ERROR', errcode: 26 });
    expect(normalizeSqliteError(cause, false)).toMatchObject({
      kind: 'sql_connection',
      transient: false,
      cause,
    });
  });

  it('classifies a statement on a database the driver closed as a connection error', () => {
    const db = new DatabaseSync(':memory:');
    closeDatabase(db);
    const cause = thrownBy(() => db.exec('select 1'));

    expect(cause).toMatchObject({ code: 'ERR_INVALID_STATE' });
    expect(normalizeSqliteError(cause, wasClosedByDriver(db))).toMatchObject({
      kind: 'sql_connection',
      transient: false,
      cause,
    });
  });

  it('keeps a wrong-state error on an open database a query error', () => {
    const db = new DatabaseSync(':memory:');
    const cause = thrownBy(() => db.prepare('select $a as a').all({ b: 1 }));

    expect(cause).toMatchObject({ code: 'ERR_INVALID_STATE' });
    expect(normalizeSqliteError(cause, wasClosedByDriver(db))).toMatchObject({
      kind: 'sql_query',
      sqlState: 'HY000',
      cause,
    });
  });

  it('classifies a busy database as a transient connection error', () => {
    const cause = Object.assign(new Error('database is locked'), {
      code: 'ERR_SQLITE_ERROR',
      errcode: 5,
    });

    expect(normalizeSqliteError(cause, false)).toMatchObject({
      kind: 'sql_connection',
      transient: true,
    });
  });

  it('extracts the constraint name of a unique violation', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table user (email text unique)');
    db.exec("insert into user values ('a@example.com')");
    const cause = thrownBy(() => db.exec("insert into user values ('a@example.com')"));

    expect(normalizeSqliteError(cause, false)).toMatchObject({
      kind: 'sql_query',
      sqlState: '23505',
      constraint: 'user.email',
    });
  });

  it('returns a non-SQLite error with a lock message as-is', () => {
    const error = new Error('database is locked');

    expect(normalizeSqliteError(error, false)).toBe(error);
  });
});
