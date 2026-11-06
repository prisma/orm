import type { StorageTable } from '@internal/sql-contract/types';
import type { TableProxy } from './table-proxy';

export type CapabilitiesBase = Record<string, Record<string, boolean>>;

type NamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

// The application-domain models the table-proxy helpers read to map a storage
// table -> model and column -> field within a namespace coordinate. The index
// signature lets the helpers index `C['domain']['namespaces'][NsId]` by a
// generic `NsId` directly, so `FindModelForTable` / `FindFieldForColumn` no
// longer need a `C extends Contract<SqlStorage>` guard to reach the per-namespace
// models; concrete emitted contracts (whose models are richer) satisfy it.
type NamespaceDomain = Readonly<
  Record<string, { readonly models: Readonly<Record<string, unknown>> }>
>;

export type TableProxyContract = {
  readonly domain: {
    readonly namespaces: NamespaceDomain;
  };
  readonly storage: {
    readonly namespaces: Readonly<Record<string, { readonly entries: NamespaceEntries }>>;
  };
  readonly capabilities: CapabilitiesBase;
};

type TablesInNamespace<NS extends { readonly entries: NamespaceEntries }> =
  NS['entries']['table'] extends Readonly<Record<string, StorageTable>>
    ? NS['entries']['table']
    : Readonly<Record<string, StorageTable>>;

// Union of every table name declared in any namespace of `C`. Replaces
// the prior `UnboundTables<C>` indexing (which only saw `__unbound__`).
export type UnboundTables<C extends TableProxyContract> = {
  readonly [Name in TableNamesAcrossNamespaces<C>]: TableInAnyNamespace<C, Name>;
};

export type TableNamesInNamespace<
  C extends TableProxyContract,
  NsId extends keyof C['storage']['namespaces'],
> = keyof TablesInNamespace<C['storage']['namespaces'][NsId]> & string;

export type TableNamesAcrossNamespaces<C extends TableProxyContract> = {
  [NSId in keyof C['storage']['namespaces']]: keyof TablesInNamespace<
    C['storage']['namespaces'][NSId]
  > &
    string;
}[keyof C['storage']['namespaces']];

export type TableInAnyNamespace<C extends TableProxyContract, Name extends string> = {
  [NSId in keyof C['storage']['namespaces']]: Name extends keyof TablesInNamespace<
    C['storage']['namespaces'][NSId]
  >
    ? TablesInNamespace<C['storage']['namespaces'][NSId]>[Name]
    : never;
}[keyof C['storage']['namespaces']];

// The exact storage table at a single namespace coordinate. Resolving through
// the coordinate (rather than the cross-namespace `UnboundTables` union) keeps
// a bare table name shared across namespaces resolving to each namespace's own
// table — no per-namespace column intersection. `TablesInNamespace` narrows the
// open-dict `entries['table']` (`Record<string, unknown>`) back to the typed
// `StorageTable` map before indexing by the bare name.
export type NamespaceTable<
  C extends TableProxyContract,
  NsId extends string,
  Name extends string,
> = TablesInNamespace<C['storage']['namespaces'][NsId]>[Name];

// The tables of a single storage namespace, keyed by bare table name. Lets
// callers reach a table by its namespace coordinate (`db.<ns>.<table>`) when
// the same bare name is declared in more than one namespace. The `NsId`
// coordinate is threaded into each `TableProxy` so its column/field resolution
// is a function of `(NsId, Name)`, not `Name` alone.
export type Namespace<
  C extends TableProxyContract,
  NsId extends string & keyof C['storage']['namespaces'],
> = {
  readonly [Name in keyof TablesInNamespace<C['storage']['namespaces'][NsId]> & string]: TableProxy<
    C,
    NsId,
    Name
  >;
};

/**
 * The contract-bound SQL surface: one facet per storage namespace, and nothing
 * else.
 *
 * A namespace may be named anything the database allows, `raw` included. The
 * client carries whole-query raw statements on its own lane, `db.raw.sql`.
 * This map does not reach that lane.
 */
export type Db<C extends TableProxyContract> = {
  readonly [Ns in keyof C['storage']['namespaces'] & string]: Namespace<C, Ns>;
};
