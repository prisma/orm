import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/sql-contract-ts/contract-builder';
import type sqlitePack from '@internal/target-sqlite/pack';

type SqliteCodecTypes = ExtractCodecTypesFromPack<typeof sqlitePack>;

/**
 * The `enumType` authors call when building a SQLite contract (re-exported from `@internal/sqlite/contract-builder`). Bound to the SQLite pack's codec typemap, so each `member()` value is checked against the enum codec's input type.
 */
export const enumType = bindEnumType<SqliteCodecTypes>();
