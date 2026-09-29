import { col, lit } from '@internal/sql-relational-core/contract-free';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { SqliteCreateTable } from '@internal/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const lookup = createSqliteBuiltinCodecLookup();
const adapter = new SqliteControlAdapter(lookup);

async function createTable(codecId: string, value: number): Promise<string> {
  const stored = lookup.get(codecId)!.encodeJson(value);
  const table = new SqliteCreateTable({
    table: 't',
    columns: [col('c', 'REAL', { default: lit(stored), codecRef: { codecId } })],
  });
  const lowered = await adapter.lowerToExecuteRequest(table, { contract: {} as SqliteContract });
  return lowered.sql;
}

describe('an infinite float default in SQLite DDL', () => {
  it.each([['sqlite/real@1'], ['sql/float@1']])(
    '%s renders as the number SQLite reads as an infinity',
    async (codecId) => {
      const tables = await Promise.all(
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].map((value) =>
          createTable(codecId, value),
        ),
      );
      expect(tables).toEqual(
        ['9e999', '-9e999'].map((text) => `CREATE TABLE "t" (\n  "c" REAL DEFAULT ${text}\n)`),
      );
    },
  );

  it('sql/float@1 refuses a NaN default, which SQLite would store as NULL', async () => {
    await expect(createTable('sql/float@1', Number.NaN)).rejects.toThrow(
      expect.objectContaining({ code: 'CONTRACT.DEFAULT_INVALID' }),
    );
  });

  it('sqlite/real@1 refuses a NaN default when the contract is built', () => {
    expect(() => lookup.get('sqlite/real@1')!.encodeJson(Number.NaN)).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.ENCODE_FAILED',
        message: 'sqlite/real@1 value must be a number other than NaN, which SQLite cannot store',
      }),
    );
  });
});
