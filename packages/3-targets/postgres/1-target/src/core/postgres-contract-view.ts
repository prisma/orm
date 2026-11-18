import type { Contract } from '@internal/contract/types';
import {
  buildSqlSchemaQualifiedView,
  type SqlSchemaQualifiedView,
} from '@internal/sql-contract/contract-view';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from './postgres-contract-serializer';

/**
 * A schema-qualified Postgres contract view: the deserialized contract
 * intersected with a single `namespace` member holding every schema by id. It is
 * substitutable for `Contract` (carries `storage`, `domain`, …) and reaches each
 * schema's entities through `view.namespace.<schema>`:
 *
 * ```ts
 * const view = PostgresContractView.fromJson<Contract>(contractJson);
 * view.namespace.public.table.users      // typed table leaf in the public schema
 * view.namespace.auth.table.users        // the auth schema's own users table
 * view.namespace.public.entries.policy.X // pack-contributed kind (RLS / #771 path)
 * view.namespace.__unbound__.table.X     // default schema, keyed by its raw id
 * view.storage                           // the full contract is still present
 * ```
 *
 * This mirrors the runtime `db.enums.<ns>` keying exactly (the default schema
 * keeps its literal `__unbound__` id). Schema names are NOT promoted to the
 * contract root, so there is no collision with contract envelope fields — a
 * schema named `storage` is `view.namespace.storage`, while `view.storage`
 * stays the contract's `storage`.
 */
export type PostgresContractView<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> =
  SqlSchemaQualifiedView<TContract>;

export const PostgresContractView = {
  /** Wrap an already-deserialized Postgres contract in a schema-qualified view. */
  from<TContract extends Contract<SqlStorage>>(
    contract: TContract,
  ): PostgresContractView<TContract> {
    return buildSqlSchemaQualifiedView(contract);
  },

  /** Deserialize a Postgres contract JSON envelope and wrap it in a view. */
  fromJson<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>(
    json: unknown,
  ): PostgresContractView<TContract> {
    const contract = new PostgresContractSerializer().deserializeContract<TContract>(json);
    return buildSqlSchemaQualifiedView(contract);
  },
};
