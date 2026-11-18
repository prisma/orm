import {
  createSqliteBuiltinCodecLookup,
  type SqliteCodecRegistry,
} from '@internal/target-sqlite/codecs';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import { SqliteControlAdapter } from '../../src/core/control-adapter';

/** A control adapter that resolves introspected column types over the SQLite target's data types. */
export function createTestSqliteControlAdapter(
  codecRegistry: SqliteCodecRegistry = createSqliteBuiltinCodecLookup(),
): SqliteControlAdapter {
  return new SqliteControlAdapter(codecRegistry, sqliteDataTypes);
}
