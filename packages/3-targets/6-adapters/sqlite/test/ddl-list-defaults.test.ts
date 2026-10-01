import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { SqliteCreateTable } from '@internal/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

function lower(nativeType: string, codecId: string, value: readonly (string | number)[]) {
  return adapter.lowerToExecuteRequest(
    new SqliteCreateTable({
      table: 't',
      columns: [col('c', nativeType, { default: lit([...value]), codecRef: { codecId } })],
    }),
    { contract: {} as SqliteContract },
  );
}

describe('a list default in SQLite DDL, which the column codec reads as one value because SQLite stores no lists', () => {
  it('is refused on a text column, naming the column', async () => {
    await expect(lower('text', 'sqlite/text@1', ['a', 1])).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: {
          table: 't',
          column: 'c',
          codecId: 'sqlite/text@1',
          value: ['a', 1],
          reason: 'codec-refused-default',
        },
      }),
    );
  });

  it('is written as its document on a JSON column', async () => {
    expect((await lower('text', 'sqlite/json@1', ['a', 1])).sql).toBe(
      `CREATE TABLE "t" (\n  "c" text DEFAULT '["a",1]'\n)`,
    );
  });
});
