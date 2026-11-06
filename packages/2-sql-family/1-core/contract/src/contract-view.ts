import type { Contract } from '@internal/contract/types';
import {
  buildNamespacedEntities,
  buildSingleNamespaceView,
  type DefaultNamespaceEntries,
  type NamespacedEntities,
  type SingleNamespaceView,
} from '@internal/framework-components/ir';
import type { SqlStorage } from './ir/sql-storage';

/**
 * The SQL family's statically-named built-in entity kinds. `table` and
 * `valueSet` are promoted to top-level view accessors; pack-contributed kinds
 * (e.g. `policy`) stay under `.entries`.
 */
export const SQL_BUILTIN_KINDS = ['table', 'valueSet', 'valueObject'] as const;
export type SqlBuiltinKind = (typeof SQL_BUILTIN_KINDS)[number];

type SqlEntries<TContract extends Contract<SqlStorage>> = DefaultNamespaceEntries<
  TContract['storage']
>;

/**
 * The single-namespace SQL accessors: `table`/`valueSet` top-level, pack kinds
 * under `entries`. A target that never emits a built-in kind (SQLite has
 * `sql.enums: false`, so it emits no `valueSet`) resolves that slot to an empty
 * map.
 */
export type SqlSingleNamespaceAccessors<TContract extends Contract<SqlStorage>> =
  SingleNamespaceView<SqlEntries<TContract>, SqlBuiltinKind>;

/**
 * Single-namespace SQL view: the deserialized contract intersected with the
 * by-name accessors, so the value is substitutable for `Contract` while also
 * exposing:
 *  - `view.table.<name>` / `view.valueSet.<name>` — built-in kinds, sole
 *    namespace unwrapped to the root; pack kinds under `view.entries.<kind>`.
 *  - `view.namespace.<id>` — the namespace-keyed entity map (SQLite's sole
 *    namespace is `__unbound__`). Mirrors the runtime `db.enums` pattern.
 */
export type SqlSingleNamespaceView<TContract extends Contract<SqlStorage>> = TContract &
  SqlSingleNamespaceAccessors<TContract> & {
    readonly namespace: NamespacedEntities<TContract['storage'], SqlBuiltinKind>;
  };

/**
 * Builds the single-namespace SQL view: unwraps the sole namespace's SQL
 * built-in kinds (`table`, `valueSet`) to the root, attaches the namespace-keyed
 * `namespace` map, and layers both over the deserialized contract. Targets with
 * one default namespace (SQLite) call this directly; Postgres qualifies by
 * schema.
 */
export function buildSqlSingleNamespaceView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSingleNamespaceView<TContract> {
  const rootAccessors = buildSingleNamespaceView<SqlSingleNamespaceAccessors<TContract>>(
    contract.storage,
    SQL_BUILTIN_KINDS,
  );
  const namespace = buildNamespacedEntities<
    NamespacedEntities<TContract['storage'], SqlBuiltinKind>
  >(contract.storage, SQL_BUILTIN_KINDS);
  return {
    ...contract,
    ...rootAccessors,
    namespace,
  };
}

/**
 * Schema-qualified SQL view: the deserialized contract intersected with a single
 * `view.namespace.<id>` member — every schema reached by raw id
 * (`view.namespace.public.table.users`), mirroring the runtime `db.enums.<ns>`
 * keying exactly (the default schema keeps its literal `__unbound__` id). There
 * is NO root schema-name promotion, so there is no collision with contract
 * envelope fields — `view.storage` is always the contract's `storage`. Postgres
 * uses this; SQLite (single default namespace) uses
 * {@link buildSqlSingleNamespaceView}.
 */
export type SqlSchemaQualifiedView<TContract extends Contract<SqlStorage>> = TContract & {
  readonly namespace: NamespacedEntities<TContract['storage'], SqlBuiltinKind>;
};

/**
 * Builds the schema-qualified SQL view: attaches the namespace-keyed `namespace`
 * map over the deserialized contract. Postgres uses this.
 */
export function buildSqlSchemaQualifiedView<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqlSchemaQualifiedView<TContract> {
  const namespace = buildNamespacedEntities<
    NamespacedEntities<TContract['storage'], SqlBuiltinKind>
  >(contract.storage, SQL_BUILTIN_KINDS);
  return {
    ...contract,
    namespace,
  };
}
