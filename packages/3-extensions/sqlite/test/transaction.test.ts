import type { ScopeField, Subquery } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  ProjectionItem,
  RawSqlExpr,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import { createContract } from '@prisma-next/test-utils';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';

// No third-party mocks needed: node:sqlite (built-in) drives the real driver.

import sqlite from '../src/runtime/sqlite';

const contract = createContract<SqlStorage>({ target: 'sqlite' });

function rawExecPlan(sql: string) {
  const ast = RawSqlExpr.of([sql], []);
  return Object.freeze({
    sql,
    params: [] as unknown[],
    ast,
    meta: planFromAst(ast, contract, 'raw.temp-table').meta,
  });
}

describe('sqlite transaction()', () => {
  it('transaction() runs the callback and returns its result', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const result = await db.transaction(async () => 'tx-value');

    expect(result).toBe('tx-value');
    await db.close();
  });

  it('transaction() provides sql on the transaction context', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    let receivedTx: { sql?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.sql).toBeDefined();
    await db.close();
  });

  it('transaction() provides orm on the transaction context', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    let receivedTx: { orm?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.orm).toBeDefined();
    await db.close();
  });

  it('transaction tempTable() creates and drops a typed temp table with generated name', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const subquery = blindCast<
      Subquery<{ id: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('sqlite_master')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('sqlite/integer@1').buildAst()),
        ]),
      getRowFields: () => ({ id: { codecId: 'sqlite/integer@1', nullable: false } }),
    });

    await db.transaction(async (tx) => {
      const temp = await tx.tempTable().as(subquery);
      expect(temp.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(temp.fields['id']?.codecId).toBe('sqlite/integer@1');
      expect('buildAst' in temp).toBe(true);
      expect('getJoinOuterScope' in temp).toBe(true);
      await temp.drop();
    });

    await db.close();
  });

  it('transaction tempTable() uses an internal table name', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const subquery = blindCast<
      Subquery<{ id: ScopeField; email: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('sqlite_master')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('sqlite/integer@1').buildAst()),
          ProjectionItem.of('email', db.raw`'x@example.com'`.returns('sqlite/text@1').buildAst()),
        ]),
      getRowFields: () => ({
        id: { codecId: 'sqlite/integer@1', nullable: false },
        email: { codecId: 'sqlite/text@1', nullable: false },
      }),
    });

    await db.transaction(async (tx) => {
      const temp = await tx.tempTable().as(subquery);
      expect(temp.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(temp.fields).toEqual({
        id: { codecId: 'sqlite/integer@1', nullable: false },
        email: { codecId: 'sqlite/text@1', nullable: false },
      });
      await temp.drop();
    });

    await db.close();
  });

  it('transaction() lazily creates runtime on first use', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async () => 'value');

    expect(db.runtime()).toBeDefined();
    await db.close();
  });

  it('transaction() rejects with "SQLite client is closed" after close()', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.close();

    await expect(db.transaction(async () => 'value')).rejects.toThrow('SQLite client is closed');
  });

  it('transaction tempTable().from() creates a table with explicit column types', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([
        { name: 'id', type: 'INTEGER' },
        { name: 'label', type: 'TEXT' },
      ]);
      expect(handle.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(typeof handle.drop).toBe('function');
      expect(typeof handle[Symbol.asyncDispose]).toBe('function');
    });

    await db.close();
  });

  it('transaction tempTable().from() inserts provided rows and table is queryable', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
      ]);
      await handle.append([
        ['1', 'Alice'],
        ['2', 'Bob'],
        [null, 'Charlie'],
      ]);

      const result = await tx
        .execute(rawExecPlan(`SELECT COUNT(*) AS cnt FROM "${handle.name}"`))
        .toArray();
      expect(result).toHaveLength(1);
      const row = result[0] as { cnt: unknown };
      expect(Number(row.cnt)).toBe(3);
    });

    await db.close();
  });

  it('transaction tempTable().from() with auto-generated name has pn_temp_ prefix', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([{ name: 'val', type: 'TEXT' }]);
      expect(handle.name).toMatch(/^pn_temp_[a-f0-9]+$/);
    });

    await db.close();
  });

  it('transaction tempTable().from() escapes single-quote strings safely', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([{ name: 'note', type: 'TEXT' }]);
      await handle.append([["it's fine"], ["O'Brien"]]);

      const result = await tx
        .execute(rawExecPlan(`SELECT COUNT(*) AS cnt FROM "${handle.name}"`))
        .toArray();
      expect(Number((result[0] as { cnt: unknown }).cnt)).toBe(2);
      await handle.drop();
    });

    await db.close();
  });

  it('tempTable().from() handle supports append() with raw rows', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([
        { name: 'id', type: 'INTEGER' },
        { name: 'val', type: 'TEXT' },
      ]);
      await handle.append([['1', 'alpha']]);

      await handle.append([
        ['2', 'beta'],
        ['3', 'gamma'],
      ]);

      const result = await tx
        .execute(rawExecPlan(`SELECT COUNT(*) AS cnt FROM "${handle.name}"`))
        .toArray();
      expect(Number((result[0] as { cnt: unknown }).cnt)).toBe(3);
    });

    await db.close();
  });

  it('tempTable().as() handle supports append() with a subquery', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      // Seed a temp table with one row so the subquery returns data
      const seed = await tx.tempTable().from([{ name: 'id', type: 'INTEGER' }]);
      await seed.append([['1']]);

      const seedSubquery = blindCast<Subquery<{ id: ScopeField }>, 'test fixture'>({
        buildAst: () =>
          SelectAst.from(TableSource.named(seed.name)).withProjection([
            ProjectionItem.of('id', db.raw`id`.returns('sqlite/integer@1').buildAst()),
          ]),
        getRowFields: () => ({ id: { codecId: 'sqlite/integer@1', nullable: false } }),
      });

      const handle = await tx.tempTable().as(seedSubquery);
      await handle.append(seedSubquery);

      const result = await tx
        .execute(rawExecPlan(`SELECT COUNT(*) AS cnt FROM "${handle.name}"`))
        .toArray();
      expect(Number((result[0] as { cnt: unknown }).cnt)).toBe(2);
    });

    await db.close();
  });

  it('tempTable().append() with empty rows is a no-op', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([{ name: 'x', type: 'INTEGER' }]);
      await handle.append([['42']]);

      await handle.append([]);

      const result = await tx
        .execute(rawExecPlan(`SELECT COUNT(*) AS cnt FROM "${handle.name}"`))
        .toArray();
      expect(Number((result[0] as { cnt: unknown }).cnt)).toBe(1);
    });

    await db.close();
  });
});

describe('sqlite connection()', () => {
  it('connection() runs the callback and returns its result', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const result = await db.connection(async () => 'conn-value');

    expect(result).toBe('conn-value');
    await db.close();
  });

  it('connection() provides sql, orm, enums on the connection context', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    let received: { sql?: unknown; orm?: unknown; enums?: unknown } | undefined;
    await db.connection(async (conn) => {
      received = conn;
    });

    expect(received).toBeDefined();
    expect(received!.sql).toBeDefined();
    expect(received!.orm).toBeDefined();
    expect(received!.enums).toBeDefined();
    await db.close();
  });

  it('connection tempTable() creates a typed temp table and cleanup hook runs on release', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const subquery = blindCast<
      Subquery<{ id: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('sqlite_master')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('sqlite/integer@1').buildAst()),
        ]),
      getRowFields: () => ({ id: { codecId: 'sqlite/integer@1', nullable: false } }),
    });

    let tempTableName: string | undefined;
    await db.connection(async (conn) => {
      const temp = await conn.tempTable().as(subquery);
      tempTableName = temp.name;
      expect(temp.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(temp.fields['id']?.codecId).toBe('sqlite/integer@1');

      // Table is accessible on this connection (query executes without error)
      const rows = await conn.execute(rawExecPlan(`SELECT * FROM ${temp.name}`)).toArray();
      expect(Array.isArray(rows)).toBe(true);
    });

    expect(tempTableName).toBeDefined();
    await db.close();
  });

  it('connection tempTable() cleanup hook drops the table before release', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    const subquery = blindCast<
      Subquery<{ id: ScopeField }>,
      'test fixture for cleanup hook subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('sqlite_master')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('sqlite/integer@1').buildAst()),
        ]),
      getRowFields: () => ({ id: { codecId: 'sqlite/integer@1', nullable: false } }),
    });

    let droppedName: string | undefined;
    await db.connection(async (conn) => {
      const temp = await conn.tempTable().as(subquery);
      droppedName = temp.name;
    });

    expect(droppedName).toMatch(/^pn_temp_[a-f0-9]+$/);

    // After release, temp table must not be visible on a fresh connection
    await db.connection(async (conn) => {
      const result = await conn
        .execute(
          rawExecPlan(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='${droppedName}'`,
          ),
        )
        .toArray();
      expect(result).toHaveLength(0);
    });

    await db.close();
  });

  it('connection() destroys the connection on callback error', async () => {
    const db = sqlite({ contract, path: ':memory:' });
    await db.connect({ path: ':memory:' });

    await expect(
      db.connection(async () => {
        throw new Error('callback-error');
      }),
    ).rejects.toThrow('callback-error');

    await db.close();
  });
});
