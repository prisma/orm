import type { DatabaseSync, SQLOutputValue, StatementSync } from 'node:sqlite';

const MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Prepares a statement that reads every integer as a `bigint`, so a stored integer of any 64-bit size is read exactly, and `changes` and `lastInsertRowid` are exact too.
 */
export function prepareExact(db: DatabaseSync, sql: string): StatementSync {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement;
}

/**
 * A row as the application reads it: an integer within the safe integer range is a `number`, and one outside it stays the exact `bigint` for its codec to read or refuse.
 */
export function safeIntegersAsNumbers(
  row: Record<string, SQLOutputValue>,
): Record<string, SQLOutputValue> {
  for (const key in row) {
    const value = row[key];
    if (typeof value === 'bigint' && value >= MIN_SAFE_INTEGER && value <= MAX_SAFE_INTEGER) {
      row[key] = Number(value);
    }
  }
  return row;
}
