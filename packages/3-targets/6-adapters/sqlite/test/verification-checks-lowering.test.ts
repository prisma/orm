import { SQL_CHAR_CODEC_ID } from '@internal/sql-relational-core/ast';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import {
  columnExistsAst,
  indexExistsAst,
  tableExistsAst,
} from '@internal/target-sqlite/contract-free';
import { SqliteCreateTable } from '@internal/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
const ctx = { contract: {} as SqliteContract };

describe('columnExistsAst lowering — pragma_table_info verification checks', () => {
  it('lowers columnAbsent to COUNT(*) = 0 over pragma_table_info', async () => {
    const ast = columnExistsAst('users', 'email').columnAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT COUNT(*) = 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
    );
    expect(result.params).toEqual(['users', 'email']);
  });

  it('lowers columnPresent to COUNT(*) > 0 over pragma_table_info', async () => {
    const ast = columnExistsAst('users', 'email').columnPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT COUNT(*) > 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
    );
    expect(result.params).toEqual(['users', 'email']);
  });
});

describe('tableExistsAst lowering — sqlite_master table verification checks', () => {
  it('lowers tableAbsent to COUNT(*) = 0 over sqlite_master WHERE type=table AND name=?', async () => {
    const ast = tableExistsAst('users').tableAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) = 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['table', 'users']);
  });

  it('lowers tablePresent to COUNT(*) > 0', async () => {
    const ast = tableExistsAst('users').tablePresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) > 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['table', 'users']);
  });
});

describe('indexExistsAst lowering — sqlite_master index verification checks', () => {
  it('lowers indexAbsent to COUNT(*) = 0 over sqlite_master WHERE type=index AND name=?', async () => {
    const ast = indexExistsAst('idx_users_email').indexAbsent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) = 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['index', 'idx_users_email']);
  });

  it('lowers indexPresent to COUNT(*) > 0', async () => {
    const ast = indexExistsAst('idx_users_email').indexPresent();
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      `SELECT COUNT(*) > 0 AS "result" FROM "sqlite_master" WHERE ("type" = ? AND "name" = ?)`,
    );
    expect(result.params).toEqual(['index', 'idx_users_email']);
  });
});

const productionAdapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

describe('verification checks lowering — complete codec registry', () => {
  it('columnExistsAst lowers with sqlite/text@1 params without CODEC_DESCRIPTOR_MISSING', async () => {
    const ast = columnExistsAst('users', 'email').columnPresent();
    const result = await productionAdapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'SELECT COUNT(*) > 0 AS "result" FROM pragma_table_info(?) WHERE "name" = ?',
    );
    expect(result.params).toEqual(['users', 'email']);
  });

  it('SqliteCreateTable with a sql/char@1 column and literal default lowers without throwing', async () => {
    const ast = new SqliteCreateTable({
      table: 'profiles',
      columns: [
        col('code', 'TEXT', { default: lit('AB'), codecRef: { codecId: SQL_CHAR_CODEC_ID } }),
      ],
    });
    const result = await productionAdapter.lowerToExecuteRequest(ast, ctx);
    // Authored char descriptors remain available to control lowering even though
    // emission metadata intentionally filters their named output types.
    expect(result.sql).toContain(`"code" TEXT DEFAULT 'AB'`);
    expect(result.params).toEqual([]);
  });
});
