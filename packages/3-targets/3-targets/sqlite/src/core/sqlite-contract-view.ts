import type { Contract } from '@internal/contract/types';
import {
  buildSqlSingleNamespaceView,
  type SqlSingleNamespaceView,
} from '@internal/sql-contract/contract-view';
import type { SqlStorage } from '@internal/sql-contract/types';
import { SqliteContractSerializer } from './sqlite-contract-serializer';

/**
 * A SQLite contract view: the deserialized contract intersected with by-name
 * accessors. It is substitutable for `Contract` (carries `storage`, `domain`,
 * …) and also exposes the single default namespace unwrapped with the SQL
 * built-in kinds promoted:
 *
 * ```ts
 * const view = SqliteContractView.fromJson<Contract>(contractJson);
 * view.table.users      // typed table leaf
 * view.entries.policy.X // pack-contributed kind (singular key)
 * view.storage          // the full contract is still present
 * ```
 *
 * SQLite has `sql.enums: false`, so it has no native enum types, but an
 * `enum` block still emits a `valueSet` entry listing the values its columns
 * may store, and the `valueSet` slot holds those.
 */
export type SqliteContractView<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> =
  SqlSingleNamespaceView<TContract>;

export const SqliteContractView = {
  /** Wrap an already-deserialized SQLite contract in a view. */
  from<TContract extends Contract<SqlStorage>>(contract: TContract): SqliteContractView<TContract> {
    return buildSqlSingleNamespaceView(contract);
  },

  /** Deserialize a SQLite contract JSON envelope and wrap it in a view. */
  fromJson<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>(
    json: unknown,
  ): SqliteContractView<TContract> {
    const contract = new SqliteContractSerializer().deserializeContract<TContract>(json);
    return buildSqlSingleNamespaceView(contract);
  },
};
