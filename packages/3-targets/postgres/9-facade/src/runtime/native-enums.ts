import {
  createEnumAccessor,
  type EnumAccessor,
  type EnumEntriesToAccessors,
} from '@internal/contract/enum-accessor';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '@internal/target-postgres/codec-ids';

/**
 * The accessors for one namespace's value sets, leaving out each value set whose name is a domain enum's in the same namespace: a domain enum's value set takes its enum's name and namespace, and `db.enums` holds that enum. The rest are native enum types, because `native_enum` is the only pack entity that derives a value set today. Reads plain contract data, so a `validateContract`'d JSON contract works as well as a hydrated one. A member is a value, as in `CREATE TYPE … AS ENUM ('a', 'b')`, so each value is also its own name.
 */
export function buildNativeEnumsMapForNamespace(
  storage: SqlStorage,
  domain: Contract['domain'],
  namespaceId: string,
): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  const valueSets = storage.namespaces[namespaceId]?.entries.valueSet;
  if (!valueSets) return result;
  const domainEnums = domain.namespaces[namespaceId]?.enum ?? {};
  for (const [name, valueSet] of Object.entries(valueSets)) {
    if (Object.hasOwn(domainEnums, name)) continue;
    result[name] = createEnumAccessor({
      codecId: PG_ENUM_CODEC_ID,
      members: valueSet.values.map((value) => ({ name: String(value), value })),
    });
  }
  return result;
}

export function buildNamespacedNativeEnums(
  storage: SqlStorage,
  domain: Contract['domain'],
): Record<string, Record<string, EnumAccessor>> {
  const result: Record<string, Record<string, EnumAccessor>> = {};
  for (const namespaceId of Object.keys(storage.namespaces)) {
    result[namespaceId] = buildNativeEnumsMapForNamespace(storage, domain, namespaceId);
  }
  return result;
}

type Present<T> = Exclude<T, undefined>;

type NamespaceValueSetEntries<TNs> = TNs extends {
  readonly entries: { readonly valueSet?: infer E };
}
  ? unknown extends E
    ? Record<never, never>
    : Present<E>
  : Record<never, never>;

type ValueSetEntry = { readonly values: readonly unknown[] };

// Mapped over a bare type parameter (mirroring `MemberValues`/`MemberNames` in
// `enum-accessor.ts`) so the mapped type is homomorphic — a readonly tuple of
// values yields a readonly tuple of members, not a plain `{ 0: …; 1: … }`
// object keyed by every `Array.prototype` member name. `name` narrows to
// `string` via `Extract` — native-enum values are always strings (Postgres
// enum labels), but `StorageValueSet['values']` is `readonly JsonValue[]`
// generically, and `ContractEnumAccessor`'s member name must be `string`.
type ValueSetMembers<Values extends readonly unknown[]> = {
  readonly [I in keyof Values]: {
    readonly name: Extract<Values[I], string>;
    readonly value: Values[I];
  };
};

/**
 * Projects a value-only `StorageValueSet`-shaped literal type onto the
 * `{name, value}[]`-member shape `ContractEnumAccessor` expects, treating
 * each value as its own name (Option B: a native-enum member is a value, not
 * a name→value pair).
 */
type ValueSetToEnumEntry<Entry extends ValueSetEntry> = {
  readonly members: ValueSetMembers<Entry['values']>;
};

type ValueSetEntriesToEnumEntries<Entries, DomainEnumNames> = {
  readonly [K in keyof Entries as Exclude<K, DomainEnumNames>]: Entries[K] extends ValueSetEntry
    ? ValueSetToEnumEntry<Entries[K]>
    : never;
};

type DomainEnumNames<
  TContract extends Contract,
  Ns,
> = Ns extends keyof TContract['domain']['namespaces']
  ? TContract['domain']['namespaces'][Ns] extends { readonly enum?: infer E }
    ? string extends keyof Present<E>
      ? never
      : keyof Present<E>
    : never
  : never;

/**
 * Accessor type for `db.nativeEnums`. Types off the namespace's `valueSet` entries, the same surface that types column value unions, leaving out each one the namespace's domain `enum` entries name, as the runtime does. For a no-emit (`typeof contract`) contract the storage type is non-literal and this degrades to the structural shape, the same emit/no-emit boundary column typing has (TML-2960).
 */
export type NamespacedNativeEnums<TContract extends Contract> = {
  readonly [Ns in keyof TContract['storage']['namespaces']]: EnumEntriesToAccessors<
    ValueSetEntriesToEnumEntries<
      NamespaceValueSetEntries<TContract['storage']['namespaces'][Ns]>,
      DomainEnumNames<TContract, Ns>
    >
  >;
};
