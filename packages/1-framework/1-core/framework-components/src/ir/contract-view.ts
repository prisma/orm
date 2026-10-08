import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { UNBOUND_NAMESPACE_ID } from './namespace';
import type { Storage } from './storage';

/**
 * Extracts the entries map of a contract's single default namespace
 * (`UNBOUND_NAMESPACE_ID`). Both single-namespace families (Mongo, SQLite)
 * store all entities under this one namespace.
 */
export type DefaultNamespaceEntries<TStorage extends { readonly namespaces: object }> =
  TStorage['namespaces'] extends Record<typeof UNBOUND_NAMESPACE_ID, { readonly entries: infer E }>
    ? E
    : never;

/**
 * Generic single-namespace projection shape — one namespace's entity-kind slots.
 * A family supplies:
 *  - `TEntries` — the family's `*NamespaceEntries` type for the namespace.
 *  - `TBuiltinKinds` — the union of the family's statically-named built-in kind
 *    keys (Mongo `'collection'`; SQL `'table' | 'valueSet'`).
 *
 * Each built-in kind becomes a top-level accessor; the remaining pack-contributed
 * kinds stay under `.entries` (keyed by their registered singular kind string).
 *
 * A built-in kind that the emitted contract does not carry resolves to an empty
 * map (`Record<string, never>`), matching the runtime which always materializes
 * each built-in slot. The `& string` index-signature member of `TEntries` is
 * excluded from `.entries` so only the literal pack-kind keys remain.
 */
export type SingleNamespaceView<TEntries, TBuiltinKinds extends string> = {
  readonly [K in TBuiltinKinds]-?: K extends keyof TEntries
    ? NonNullable<TEntries[K]>
    : Record<string, never>;
} & {
  readonly entries: {
    readonly [K in Exclude<keyof TEntries, TBuiltinKinds | number | symbol> as string extends K
      ? never
      : K]: TEntries[K];
  };
};

/** The `entries` shape of one namespace in a storage map. */
type EntriesOf<TNamespace> = TNamespace extends { readonly entries: infer E } ? E : never;

/**
 * The namespace-keyed entity-view map — every storage namespace keyed by its raw
 * id, each projected to its {@link SingleNamespaceView}. Mirrors
 * `NamespacedEnums` from `@internal/contract/enum-accessor`: the migration
 * author's storage-side `view.namespace.<nsId>` is the twin of the runtime's
 * `db.enums.<nsId>`. Nesting the schema map under one fixed `namespace` member
 * makes it collision-proof — a schema named `storage` is `view.namespace.storage`,
 * never a contract-root key.
 */
export type NamespacedEntities<
  TStorage extends { readonly namespaces: object },
  TBuiltinKinds extends string,
> = {
  readonly [Ns in keyof TStorage['namespaces']]: SingleNamespaceView<
    EntriesOf<TStorage['namespaces'][Ns]>,
    TBuiltinKinds
  >;
};

/**
 * Projects one namespace's `entries` into the view shape: each built-in kind
 * becomes a top-level slot (materialized empty if absent), and the remaining
 * pack-contributed kinds sit under `.entries`. Shared by the single-namespace
 * builder and the namespace-map builder.
 */
export function promoteBuiltinKinds<TView>(
  entries: Readonly<Record<string, unknown>>,
  builtinKinds: readonly string[],
): TView {
  const view: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [kind, kindMap] of Object.entries(entries)) {
    if (builtinKinds.includes(kind)) {
      view[kind] = kindMap;
    } else {
      rest[kind] = kindMap;
    }
  }
  for (const kind of builtinKinds) {
    if (!(kind in view)) {
      view[kind] = {};
    }
  }
  view['entries'] = rest;
  return blindCast<TView, 'view is built to the SingleNamespaceView shape the caller parametrizes'>(
    view,
  );
}

/**
 * Builds one namespace's entity view: promotes the given built-in kind slots to
 * top-level for the default (`UNBOUND_NAMESPACE_ID`) namespace. Single-namespace
 * targets (Mongo, SQLite) use this to unwrap their sole namespace to the root.
 *
 * Throws if the contract has no default (`UNBOUND_NAMESPACE_ID`) namespace.
 */
export function buildSingleNamespaceView<TView>(
  storage: Storage,
  builtinKinds: readonly string[],
): TView {
  const defaultNs = storage.namespaces[UNBOUND_NAMESPACE_ID];
  if (defaultNs === undefined) {
    throw new InternalError(
      `ContractView: contract has no default namespace (${UNBOUND_NAMESPACE_ID})`,
    );
  }
  const entries = blindCast<
    Record<string, unknown>,
    'Namespace.entries is the open ADR 224 dictionary Record<string, Record<string, unknown>>'
  >(defaultNs.entries);
  return promoteBuiltinKinds<TView>(entries, builtinKinds);
}

/**
 * Builds the namespace-keyed entity-view map (`{ <nsId>: SingleNamespaceView }`)
 * for every namespace in the storage, keyed by raw namespace id. It is the storage-side
 * counterpart of `buildNamespacedEnums(domain, codecFor)`, which builds the same map of enum
 * accessors from the domain, reading each enum through the codec `codecFor` returns.
 */
export function buildNamespacedEntities<TMap>(
  storage: Storage,
  builtinKinds: readonly string[],
): TMap {
  const out: Record<string, unknown> = {};
  for (const [nsId, ns] of Object.entries(storage.namespaces)) {
    out[nsId] = promoteBuiltinKinds(
      blindCast<
        Readonly<Record<string, unknown>>,
        'Namespace.entries is the open ADR 224 dictionary Record<string, Record<string, unknown>>'
      >(ns.entries),
      builtinKinds,
    );
  }
  return blindCast<
    TMap,
    'each namespace projected to its SingleNamespaceView; keys mirror the storage namespace ids'
  >(out);
}
