import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { blindCast } from '@internal/utils/casts';
import { isInternalError } from '@internal/utils/internal-error';
import type { Contract } from './contract-types';
import type { ContractEnum } from './domain-types';
import type { JsonValue } from './types';

/**
 * The two conversions of an enum's codec that its accessor uses: `decodeJson` reads a member's stored form as the value the application reads from the database, and `encodeJson` writes a value in its stored form, which is how values are compared.
 */
export interface EnumMemberCodec {
  decodeJson(json: JsonValue): unknown;
  encodeJson(value: unknown): JsonValue;
}

/** The codec an enum's `codecId` names, or `undefined` when the runtime has none for it. */
export type EnumMemberCodecFor = (codecId: string) => EnumMemberCodec | undefined;

/**
 * Runtime view of a domain enum, built at the client from the contract's `ContractEnum` JSON and read through the enum's codec.
 *
 * This deliberately mirrors the accessor shape of the authoring-time
 * `EnumTypeHandle` (in `contract-ts`) rather than reusing it: that handle carries
 * the literal value generics and lives in the authoring layer, which the
 * foundation layer cannot depend on. The two are the same surface seen from the
 * two planes, authoring and runtime, and hold the same member values.
 */
export interface EnumAccessor {
  readonly values: readonly unknown[];
  readonly names: readonly string[];
  readonly members: Readonly<Record<string, unknown>>;
  has(v: unknown): boolean;
  hasName(name: string): boolean;
  nameOf(v: unknown): string | undefined;
  ordinalOf(v: unknown): number;
}

/**
 * Builds the accessor for one enum. Each member holds the value `codec` reads from its stored form, which is the value a query returns. A value is a member when it has the member's JavaScript type and `codec` stores it as the member is stored, so two equal dates match; a value `codec` refuses is no member. Without a codec, members are their stored forms.
 */
export function createEnumAccessor(
  contractEnum: ContractEnum,
  codec?: EnumMemberCodec,
): EnumAccessor {
  const values = Object.freeze(
    contractEnum.members.map((m) => (codec === undefined ? m.value : codec.decodeJson(m.value))),
  );
  const names = Object.freeze(contractEnum.members.map((m) => m.name));
  const members: Readonly<Record<string, unknown>> = Object.freeze(
    Object.fromEntries(names.map((name, i) => [name, values[i]])),
  );
  const storedForm = (value: unknown): unknown =>
    codec === undefined ? value : codec.encodeJson(value);

  const nameSet = Object.freeze(new Set(names));
  const ordinalByStoredForm = new Map(
    values.map((value, i) => [canonicalStringify(storedForm(value)), i]),
  );

  const ordinalOf = (v: unknown): number => {
    let key: string;
    try {
      key = canonicalStringify(storedForm(v));
    } catch (error) {
      if (isInternalError(error)) throw error;
      return -1;
    }
    const ordinal = ordinalByStoredForm.get(key);
    return ordinal !== undefined && typeof values[ordinal] === typeof v ? ordinal : -1;
  };

  return {
    values,
    names,
    members,
    has: (v: unknown) => ordinalOf(v) !== -1,
    hasName: (name: string) => nameSet.has(name),
    nameOf: (v: unknown) => {
      const ordinal = ordinalOf(v);
      return ordinal === -1 ? undefined : names[ordinal];
    },
    ordinalOf,
  };
}

export function buildEnumsMapForNamespace(
  domain: {
    readonly namespaces: Readonly<
      Record<string, { readonly enum?: Readonly<Record<string, ContractEnum>> }>
    >;
  },
  namespaceId: string,
  codecFor: EnumMemberCodecFor,
): Record<string, EnumAccessor> {
  const result: Record<string, EnumAccessor> = {};
  const namespace = domain.namespaces[namespaceId];
  if (namespace?.enum) {
    for (const [name, contractEnum] of Object.entries(namespace.enum)) {
      result[name] = createEnumAccessor(contractEnum, codecFor(contractEnum.codecId));
    }
  }
  return result;
}

export function buildNamespacedEnums<TContract extends Contract>(
  domain: TContract['domain'],
  codecFor: EnumMemberCodecFor,
): NamespacedEnums<TContract> {
  const result: Record<string, Record<string, EnumAccessor>> = {};
  for (const namespaceId of Object.keys(domain.namespaces)) {
    result[namespaceId] = buildEnumsMapForNamespace(domain, namespaceId, codecFor);
  }
  return blindCast<
    NamespacedEnums<TContract>,
    'built dynamically from domain.namespaces; the mapped-type shape cannot be proven statically'
  >(result);
}

type Present<T> = Exclude<T, undefined>;

type EnumMemberEntry = { readonly name: string; readonly value: unknown };
type EnumEntry = { readonly members: readonly EnumMemberEntry[] };

// Mapped over a bare type parameter so the mapped type is homomorphic — a
// readonly tuple of members yields a readonly tuple of values/names (array
// methods preserved), not a plain `{ 0: …; 1: … }` mapped object.
type MemberValues<Members> = {
  readonly [I in keyof Members]: Members[I] extends EnumMemberEntry ? Members[I]['value'] : never;
};

type MemberNames<Members> = {
  readonly [I in keyof Members]: Members[I] extends EnumMemberEntry ? Members[I]['name'] : never;
};

type EnumEntryValues<Entry extends EnumEntry> = MemberValues<Entry['members']>;

type EnumEntryNames<Entry extends EnumEntry> = MemberNames<Entry['members']>;

type EnumEntryMembers<Entry extends EnumEntry> = {
  readonly [M in Entry['members'][number] as M['name']]: M['value'];
};

export type ContractEnumAccessor<Entry extends EnumEntry> = {
  readonly values: EnumEntryValues<Entry>;
  readonly names: EnumEntryNames<Entry>;
  readonly members: EnumEntryMembers<Entry>;
  /** Returns true and narrows `v` to the enum's value union when `v` is a declared member value. */
  has(v: unknown): v is EnumEntryValues<Entry>[number];
  /** Returns true and narrows `name` to the enum's member-name union when `name` is a declared member name. */
  hasName(name: string): name is Extract<EnumEntryNames<Entry>[number], string>;
  nameOf(v: EnumEntryValues<Entry>[number]): string | undefined;
  ordinalOf(v: EnumEntryValues<Entry>[number]): number;
  /**
   * Type-only: the enum's value union. Absent at runtime — use `typeof X.Value`
   * to derive the type; never read `X.Value` as a value.
   */
  readonly Value: EnumEntryValues<Entry>[number];
};

/**
 * The value union for a `ContractEnumAccessor`.
 * Use in function signatures to accept any declared enum value without re-exporting
 * the member type alias from the accessor's generic entry.
 */
export type EnumValues<A> = A extends { readonly values: ReadonlyArray<infer V> } ? V : never;

/**
 * The member-name union for a `ContractEnumAccessor`.
 */
export type EnumMemberNames<A> = A extends { readonly names: ReadonlyArray<infer N> } ? N : never;

export type EnumEntriesToAccessors<Enums> = {
  readonly [K in keyof Enums]: Enums[K] extends EnumEntry ? ContractEnumAccessor<Enums[K]> : never;
};

type BuiltEnumAccessorsOf<TContract> = TContract extends {
  readonly enumAccessors?: infer A;
}
  ? Exclude<A, undefined>
  : Record<never, never>;

type DomainEnumEntries<TNamespace> = TNamespace extends {
  readonly enum?: infer E;
}
  ? unknown extends E
    ? Record<never, never>
    : Present<E>
  : Record<never, never>;

// An emitted contract types each member twice: `enum` as `contract.json` stores it, and
// `enumMemberTypes` as the application reads it, which is what the runtime accessor holds.
type NamespaceEnumEntries<TNamespace> = TNamespace extends {
  readonly enumMemberTypes?: infer MemberTuples;
}
  ? unknown extends MemberTuples
    ? DomainEnumEntries<TNamespace>
    : {
        readonly [K in keyof Present<MemberTuples>]: {
          readonly members: Present<MemberTuples>[K];
        };
      }
  : DomainEnumEntries<TNamespace>;

// When `enumAccessors` is present (TS-DSL contract), it is the sole source because merging
// both carriers would create conflicting `values` types for the same enum key.
export type NamespaceEnumAccessors<
  TContract extends Contract,
  NsId extends keyof TContract['domain']['namespaces'],
> = keyof BuiltEnumAccessorsOf<TContract> extends never
  ? EnumEntriesToAccessors<NamespaceEnumEntries<TContract['domain']['namespaces'][NsId]>>
  : BuiltEnumAccessorsOf<TContract>;

export type NamespacedEnums<TContract extends Contract> = {
  readonly [Ns in keyof TContract['domain']['namespaces']]: NamespaceEnumAccessors<TContract, Ns>;
};
