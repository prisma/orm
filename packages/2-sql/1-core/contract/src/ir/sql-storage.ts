import type { StorageHashBase } from '@internal/contract/types';
import type { AuthoringContributions } from '@internal/framework-components/authoring';
import {
  freezeNode,
  isPlainRecord,
  type Namespace,
  NamespaceBase,
  type Storage,
} from '@internal/framework-components/ir';
import { InternalError } from '@internal/utils/internal-error';
import { SqlNode } from './sql-node';
import type { StorageTable } from './storage-table';
import {
  isStorageTypeInstance,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
  toStorageTypeInstance,
} from './storage-type-instance';
import type { StorageValueSet } from './storage-value-set';

/**
 * Polymorphic value type for document-scoped `SqlStorage.types` entries
 * (codec aliases / parameterised native type registrations).
 *
 * Postgres native enum registrations live under the postgres-specific
 * `entries.type` slot on `PostgresSchema` (target layer), not here.
 */
export type SqlStorageTypeEntry = StorageTypeInstance | StorageTypeInstanceInput;

export interface SqlNamespaceInput {
  readonly id: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Target-supplied factory that materializes a `Namespace` from a SQL
 * `SqlNamespaceInput` (used to populate `SqlStorage.namespaces`).
 */
export type SqlNamespaceFactory = (input: SqlNamespaceInput) => Namespace;

/**
 * SQL-family extension of the framework `AuthoringContributions`. SQL target
 * packs add a `createNamespace` factory so the PSL/TS authoring paths can
 * materialize namespaces (and merge lowered extension-block entities) without
 * each consumer re-specifying it. The factory is SQL-specific, so it lives here
 * rather than on the framework `AuthoringContributions` base.
 */
export interface SqlAuthoringContributions extends AuthoringContributions {
  readonly createNamespace?: SqlNamespaceFactory;
}

/**
 * Narrows framework `AuthoringContributions` to the SQL-family shape by testing
 * for the SQL-specific `createNamespace` capability.
 */
export function isSqlAuthoringContributions(
  authoring: AuthoringContributions | undefined,
): authoring is SqlAuthoringContributions {
  if (authoring === undefined || !Object.hasOwn(authoring, 'createNamespace')) {
    return false;
  }
  return typeof Reflect.get(authoring, 'createNamespace') === 'function';
}

export interface SqlStorageInput<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly types?: Record<string, SqlStorageTypeEntry>;
  readonly namespaces: Readonly<Record<string, SqlNamespaceBase>>;
}

/**
 * SQL Contract IR root node for the `storage` field.
 *
 * Single concrete family-shared class — both Postgres and SQLite
 * consume this class today. Per-target storage subclasses are
 * introduced when each target's namespace shape earns its
 * target-specific concretion (target-specific derived fields,
 * target-specific storage extensions).
 *
 * Honours the framework `Storage` interface: every SQL IR carries a
 * `namespaces` map keyed by namespace id. Callers must supply fully
 * constructed `Namespace` instances — construction discipline lives
 * in the authoring builders and deserializer hydration paths.
 *
 * The constructor normalises optional `types` into class instances.
 * `types` is polymorphic per Decision 18 Option B: codec-triple inputs
 * are stamped with `kind: 'codec-instance'`; hydration of raw JSON
 * class-instance entries (carrying their narrower `kind` literal) is
 * the per-target serializer's responsibility (so the family base does
 * not import target-specific subclasses).
 */
/**
 * The typed `entries` shape for SQL family namespaces. The open dictionary
 * is intersected with optional known-kind maps so that `ns.entries.table`
 * and `ns.entries.valueSet` resolve without a cast, while unknown pack-
 * contributed kinds remain valid (the `Record` part allows any string key).
 */
export type SqlNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly table?: Readonly<Record<string, StorageTable>>;
  readonly valueSet?: Readonly<Record<string, StorageValueSet>>;
};

/**
 * Structural interface for SQL family namespaces. Generated `.d.ts` contract
 * types satisfy this structurally (no prototype methods). The runtime
 * abstract class `SqlNamespaceBase` extends this.
 *
 * `qualifyTable` and `isUnbound` are optional so JSON-shaped contract types
 * (which carry no methods) are accepted where `SqlNamespace` is required.
 * Hydrated `SqlNamespaceBase` instances always have both.
 */
export interface SqlNamespace {
  readonly kind: string;
  readonly id: string;
  readonly entries: SqlNamespaceEntries;
  readonly isUnbound?: boolean;
  qualifyTable?(tableName: string): string;
}

/**
 * Abstract SQL family namespace base class. Target concretions (`PostgresSchema`,
 * `SqliteDatabase`, …) extend this — it is never instantiated directly.
 * `entries` is the open ADR 224 dictionary: `entries[entityKind][entityName]`
 * addresses any entity.
 */
export abstract class SqlNamespaceBase extends NamespaceBase implements SqlNamespace {
  abstract override readonly id: string;
  abstract override readonly entries: SqlNamespaceEntries;

  abstract qualifyTable(tableName: string): string;
}

/**
 * Realm-safe guard for hydrated `SqlNamespaceBase` concretions. Checks
 * `qualifyTable` structurally instead of `instanceof NamespaceBase`, so it
 * survives duplicate-module boundaries (e.g. dist e2e where the target and
 * the family carry separate copies of `@internal/framework-components`).
 *
 * Every concrete `SqlNamespaceBase` subclass (`PostgresSchema`, `SqliteDatabase`,
 * `TestSqlNamespace`, …) implements `qualifyTable`. Raw `SqlNamespaceInput`
 * objects (`{ id, entries }`) do not.
 */
export function isMaterializedSqlNamespace(x: unknown): x is SqlNamespaceBase {
  if (typeof x !== 'object' || x === null || !('qualifyTable' in x)) return false;
  return typeof x.qualifyTable === 'function';
}

export class SqlStorage<THash extends string = string> extends SqlNode implements Storage {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, SqlNamespace>>;
  declare readonly types?: Readonly<Record<string, StorageTypeInstance>>;

  constructor(input: SqlStorageInput<THash>) {
    super();
    this.storageHash = input.storageHash;
    this.namespaces = Object.freeze(input.namespaces);
    if (input.types !== undefined) {
      this.types = Object.freeze(
        Object.fromEntries(
          Object.entries(input.types).map(([name, ti]) => [name, normaliseTypeEntry(name, ti)]),
        ),
      );
    }
    freezeNode(this);
  }
}

/**
 * Strict polymorphic-slot dispatch for `SqlStorage.types` entries.
 * Every entry must carry a `kind: 'codec-instance'` discriminator or
 * be an already-constructed `StorageTypeInstance`. Untagged or
 * unrecognised inputs throw a diagnostic naming the entry and its
 * `kind`, so format drift surfaces loudly at the deserializer
 * boundary instead of slipping past the seam and corrupting
 * downstream IR walks.
 *
 * Codec-triple authors that have an untagged shape on hand can call
 * `toStorageTypeInstance(...)` (which stamps the `'codec-instance'`
 * discriminator) before constructing `SqlStorage`. On-disk reads
 * cross `familyInstance.deserializeContract` first; the structural
 * arktype schema rejects untagged entries earlier, so this throw
 * only fires for in-memory authoring bugs.
 */
function normaliseTypeEntry(name: string, entry: SqlStorageTypeEntry): StorageTypeInstance {
  if (isStorageTypeInstance(entry)) {
    // Normalise on-disk objects that omit `typeParams` (the canonical on-disk
    // form strips empty typeParams to keep JSON compact). The in-memory invariant
    // is always `typeParams: {}` when empty — never `undefined`. Only create a
    // new object when necessary to preserve identity-equality for callers that
    // hold a reference to an already-correct in-memory entry.
    if ('typeParams' in entry) {
      return entry;
    }
    return toStorageTypeInstance(entry);
  }
  const rawKind = isPlainRecord(entry) && 'kind' in entry ? entry.kind : undefined;
  const kindDescription =
    rawKind === undefined
      ? 'missing `kind` discriminator'
      : `unrecognised \`kind\` discriminator ${JSON.stringify(rawKind)}`;
  throw new InternalError(
    `storage.types[${JSON.stringify(name)}] has ${kindDescription}; expected ${JSON.stringify('codec-instance')}. Untagged codec triples should be wrapped with toStorageTypeInstance(...) before construction.`,
  );
}
