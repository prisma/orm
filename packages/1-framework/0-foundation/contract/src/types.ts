/**
 * Unique symbol used as the key for branding types.
 */
export const $: unique symbol = Symbol('__prisma_8_brand__');

/**
 * A helper type to brand a given type with a unique identifier.
 *
 * @template TKey Text used as the brand key.
 * @template TValue Optional value associated with the brand key. Defaults to `true`.
 */
export type Brand<TKey extends string | number | symbol, TValue = true> = {
  [$]: {
    [K in TKey]: TValue;
  };
};

/**
 * Base type for storage contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type StorageHash = StorageHashBase<'abc123...'>`
 */
export type StorageHashBase<THash extends string> = THash & Brand<'StorageHash'>;

/**
 * Base type for execution contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type ExecutionHash = ExecutionHashBase<'def456...'>`
 */
export type ExecutionHashBase<THash extends string> = THash & Brand<'ExecutionHash'>;

export function executionHash<const T extends string>(value: T): ExecutionHashBase<T> {
  return value as ExecutionHashBase<T>;
}

export function coreHash<const T extends string>(value: T): StorageHashBase<T> {
  return value as StorageHashBase<T>;
}

/**
 * Base type for profile contract hashes.
 * Emitted contract.d.ts files use this with the hash value as a type parameter:
 * `type ProfileHash = ProfileHashBase<'def456...'>`
 */
export type ProfileHashBase<THash extends string> = THash & Brand<'ProfileHash'>;

export function profileHash<const T extends string>(value: T): ProfileHashBase<T> {
  return value as ProfileHashBase<T>;
}

/**
 * One entity-kind slot in a namespace — a map of entity name to entry.
 * Values are opaque at the foundation layer; family and target concretions
 * refine them to typed IR classes.
 */
export type StorageEntitySlot = Readonly<Record<string, unknown>>;

/**
 * Plain-data namespace entry in a storage block. Every hydrated contract
 * carries at least `id` plus entity-kind slot maps under `entries`
 * (`table`, `collection`, …). Foundation declares only this shape — no IR
 * machinery.
 */
export interface StorageNamespace {
  readonly id: string;
  readonly entries: Readonly<Record<string, StorageEntitySlot>>;
}

/**
 * Base type for family-specific storage blocks.
 * Family storage types (SqlStorage, MongoStorage, etc.) extend this to carry the
 * storage hash alongside family-specific data (tables, collections, etc.).
 *
 * The `namespaces` map is carried by every hydrated storage block. Serialized
 * envelope shape is target-owned; this types the in-memory contract after
 * `deserializeContract`.
 */
export interface StorageBase<THash extends string = string> {
  readonly storageHash: StorageHashBase<THash>;
  readonly namespaces: Readonly<Record<string, StorageNamespace>>;
}

export interface FieldType {
  readonly type: string;
  readonly nullable: boolean;
  readonly items?: FieldType;
  readonly properties?: Record<string, FieldType>;
}

export type GeneratedValueSpec = {
  readonly id: string;
  readonly params?: Record<string, unknown>;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type ColumnDefaultLiteralValue = JsonValue;

export type ColumnDefaultLiteralInputValue = ColumnDefaultLiteralValue | Date;

/**
 * Runtime predicate for `ColumnDefaultLiteralInputValue`. Authoring layers
 * resolve template values from caller-supplied args (typed `unknown` at the
 * boundary) and need to validate before constructing a `ColumnDefault`.
 * Accepts JSON primitives, plain arrays/objects of JSON values, and `Date`
 * instances. Rejects functions, class instances (other than `Date`),
 * `undefined`, `bigint`, `symbol`, and arrays/objects containing those.
 */
export function isColumnDefaultLiteralInputValue(
  value: unknown,
): value is ColumnDefaultLiteralInputValue {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every(isColumnDefaultLiteralInputValue);
  if (t === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value as Record<string, unknown>).every(isColumnDefaultLiteralInputValue);
  }
  return false;
}

export type ColumnDefault =
  | {
      readonly kind: 'literal';
      readonly value: ColumnDefaultLiteralInputValue;
    }
  | { readonly kind: 'function'; readonly expression: string };

export function isColumnDefault(value: unknown): value is ColumnDefault {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'literal') {
    return 'value' in value;
  }
  if (kind === 'function') {
    return typeof (value as { expression?: unknown }).expression === 'string';
  }
  return false;
}

export type ExecutionMutationDefaultValue = {
  readonly kind: 'generator';
  readonly id: GeneratedValueSpec['id'];
  readonly params?: Record<string, unknown>;
};

export function isExecutionMutationDefaultValue(
  value: unknown,
): value is ExecutionMutationDefaultValue {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {
    kind?: unknown;
    id?: unknown;
    params?: unknown;
  };
  if (candidate.kind !== 'generator') return false;
  if (typeof candidate.id !== 'string') return false;
  if (
    candidate.params !== undefined &&
    (typeof candidate.params !== 'object' ||
      candidate.params === null ||
      Array.isArray(candidate.params))
  ) {
    return false;
  }
  return true;
}

export type ExecutionMutationDefault = {
  readonly ref: { readonly namespace: string; readonly table: string; readonly column: string };
  readonly onCreate?: ExecutionMutationDefaultValue;
  readonly onUpdate?: ExecutionMutationDefaultValue;
};

/**
 * `ExecutionMutationDefault` minus its `ref` — the per-field phases value
 * authoring layers attach to a column before the column ref is known.
 */
export type ExecutionMutationDefaultPhases = Omit<ExecutionMutationDefault, 'ref'>;

export type ExecutionSection<THash extends string = string> = {
  readonly executionHash: ExecutionHashBase<THash>;
  readonly mutations: {
    readonly defaults: ReadonlyArray<ExecutionMutationDefault>;
  };
};

export interface Source {
  readonly readOnly: boolean;
  readonly projection: Record<string, FieldType>;
  readonly origin?: Record<string, unknown>;
  readonly capabilities?: Record<string, boolean>;
}

// Document family types
export interface DocIndex {
  readonly name: string;
  readonly keys: Record<string, 'asc' | 'desc'>;
  readonly unique?: boolean;
  readonly where?: Expr;
}

export type Expr =
  | { readonly kind: 'eq'; readonly path: ReadonlyArray<string>; readonly value: unknown }
  | { readonly kind: 'exists'; readonly path: ReadonlyArray<string> };

export interface DocCollection {
  readonly name: string;
  readonly id?: {
    readonly strategy: 'auto' | 'client' | 'uuid' | 'objectId';
  };
  readonly fields: Record<string, FieldType>;
  readonly indexes?: ReadonlyArray<DocIndex>;
  readonly readOnly?: boolean;
}

export interface PlanMeta {
  readonly target: string;
  readonly targetFamily?: string;
  readonly storageHash: string;
  readonly profileHash?: string;
  readonly lane: string;
  readonly annotations?: {
    readonly [key: string]: unknown;
  };
}

/**
 * Contract marker record stored in the database.
 * Represents the current contract identity for a database.
 */
export interface ContractMarkerRecord {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly contractJson: unknown | null;
  readonly canonicalVersion: number | null;
  readonly updatedAt: Date;
  readonly appTag: string | null;
  readonly meta: Record<string, unknown>;
  readonly invariants: readonly string[];
}

/**
 * One applied migration edge from the per-space ledger journal.
 * Returned by `readLedger` in append (apply) order.
 */
export interface LedgerEntryRecord {
  readonly space: string;
  readonly migrationName: string;
  readonly migrationHash: string;
  readonly from: string | null;
  readonly to: string;
  readonly appliedAt: Date;
  readonly operationCount: number;
}
