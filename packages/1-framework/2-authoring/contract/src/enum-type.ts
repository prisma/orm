import {
  duplicateStoredMembers,
  type StoredEnumMember,
} from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { contractError } from './contract-errors';

/**
 * A single enum member produced by `member()`. The `Name` and `Value` generics
 * are preserved as literal types so `enumType()` can carry the ordered value
 * tuple in its return type. `Value` is whatever the codec dictates — its type
 * is constrained at `enumType` against the codec's input type, not here.
 */
export interface EnumMember<Name extends string, Value> {
  readonly name: Name;
  readonly value: Value;
}

/**
 * Declare an enum member. The `value` defaults to `name` when omitted. The
 * value is an unconstrained literal here; `enumType` constrains it against the
 * codec's input type. Both generics are preserved as literals so downstream
 * `enumType` carries the value union in its type; the value is serialized to its
 * codec string form only at lowering.
 */
export function member<const Name extends string>(name: Name): EnumMember<Name, Name>;
export function member<const Name extends string, const Value>(
  name: Name,
  value: Value,
): EnumMember<Name, Value>;
export function member<const Name extends string, const Value = Name>(
  name: Name,
  value?: Value,
): EnumMember<Name, Value> {
  return {
    name,
    value: blindCast<
      Value,
      'overload signatures enforce Value=Name when value is omitted; default generic Value=Name makes this safe'
    >(value === undefined ? name : value),
  };
}

type MembersToValues<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [K in keyof Members]: Members[K] extends EnumMember<string, infer V> ? V : never;
};

type MembersToNames<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [K in keyof Members]: Members[K] extends EnumMember<infer N, unknown> ? N : never;
};

type MembersAccessorMap<Members extends readonly EnumMember<string, unknown>[]> = {
  readonly [M in Members[number] as M['name']]: M['value'];
};

// String-key brand rather than unique symbol: tsdown inlines a fresh unique
// symbol into each extension's .d.mts when the source package is transitive,
// breaking nominal type identity across chunk boundaries. A string constant
// survives .d.mts de-duplication because string equality is preserved by value.
// Mirrors the FILTER_EXPR_BRAND pattern in mongo-query-ast/filter-expressions.ts.
export const ENUM_TYPE_HANDLE_BRAND = '__prismaNextEnumTypeHandle__';

/** Authoring handle returned by `enumType()`. Generic over the ordered value tuple so `const Role = enumType(...)` retains literal types. */
export interface EnumTypeHandle<
  Name extends string = string,
  Values extends readonly unknown[] = readonly unknown[],
  Names extends readonly string[] = readonly string[],
  MembersMap extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Internal brand for lowering-pipeline detection. */
  readonly [ENUM_TYPE_HANDLE_BRAND]: true;

  /** The enum's declared name (used as the key in domain `enum` / storage `valueSet`). */
  readonly enumName: Name;

  /** codecId from the codec passed to `enumType`. */
  readonly codecId: string;

  /** Ordered member list for lowering (name + value pairs). */
  readonly enumMembers: readonly { readonly name: string; readonly value: Values[number] }[];

  /** Ordered literal value tuple. Declaration order is preserved. */
  readonly values: Values;

  /** Ordered literal name tuple. Declaration order is preserved. */
  readonly names: Names;

  /**
   * Namespaced accessor map: `Role.members.User === 'user'`.
   * Namespaced under `.members` to avoid collisions with `.values` / `.has`.
   */
  readonly members: MembersMap;

  /** Returns `true` if `v` is a declared member value. */
  has(v: Values[number]): boolean;

  /** Returns the member name for a value, or `undefined` if not found. */
  nameOf(v: Values[number]): string | undefined;

  /** Returns the zero-based declaration index of a value, or `-1` if not found. */
  ordinalOf(v: Values[number]): number;
}

/**
 * A codec typemap: codecId → `{ input, output }`, the same shape the query
 * lanes consume. The bound `enumType` wrappers supply the target pack's
 * typemap; the core defaults to an empty map (no codec is known), so member
 * values stay unconstrained.
 */
export type CodecTypeMap = Record<string, { readonly input?: unknown }>;

/**
 * The application input type the codec dictates for an enum's member values:
 * looks `Codec['codecId']` up in the supplied codec typemap. When the codecId
 * isn't in the map the input is unconstrained, so any member-value literal is
 * accepted and inferred verbatim.
 */
export type CodecInput<
  CodecTypes extends CodecTypeMap,
  Codec extends { readonly codecId: string },
> = Codec['codecId'] extends keyof CodecTypes
  ? CodecTypes[Codec['codecId']] extends { readonly input: infer In }
    ? In
    : unknown
  : unknown;

function describeValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Declare a domain enum for use in TS-authoring contracts.
 *
 * - The codec is an explicit required argument — the `codecId` is taken
 *   from the passed `ColumnTypeDescriptor` (e.g. `{ codecId: 'pg/text@1' }`
 *   from a field preset output or a direct inline object).
 * - `const` generics on the members spread preserve the ordered literal
 *   value tuple so `Role.values` is `readonly ['user','admin']`, not
 *   `string[]`.
 * - Well-formedness assertions at construction: non-empty member list;
 *   unique names; no two values equal by SameValueZero, the equality `has`,
 *   `nameOf` and `ordinalOf` use. The contract build also refuses two members
 *   that store the same value, because only the codec knows how a value is
 *   stored.
 *
 * The returned handle wires into `field.namedType(handle)` to set
 * `valueSet` refs on both the domain field and the storage column.
 *
 * @example
 * ```ts
 * const Role = enumType('Role', { codecId: 'pg/text@1' },
 *   member('User', 'user'),
 *   member('Admin', 'admin'),
 * );
 * // Role.values → readonly ['user', 'admin']
 * // Role.members.User → 'user'
 * ```
 */
export function enumType<
  CodecTypes extends CodecTypeMap = Record<string, never>,
  const Name extends string = string,
  const Codec extends Pick<ColumnTypeDescriptor, 'codecId'> = Pick<ColumnTypeDescriptor, 'codecId'>,
  const Members extends readonly [
    EnumMember<string, CodecInput<CodecTypes, Codec>>,
    ...EnumMember<string, CodecInput<CodecTypes, Codec>>[],
  ] = readonly [EnumMember<string, CodecInput<CodecTypes, Codec>>],
>(
  name: Name,
  codec: Codec,
  ...members: Members
): EnumTypeHandle<
  Name,
  MembersToValues<[...Members]>,
  MembersToNames<[...Members]>,
  MembersAccessorMap<[...Members]>
>;
export function enumType(
  name: string,
  codec: Pick<ColumnTypeDescriptor, 'codecId'>,
  ...members: EnumMember<string, unknown>[]
): EnumTypeHandle;
export function enumType(
  name: string,
  codec: Pick<ColumnTypeDescriptor, 'codecId'>,
  ...members: EnumMember<string, unknown>[]
): EnumTypeHandle {
  if (members.length === 0) {
    throw contractError(
      'CONTRACT.ENUM_INVALID',
      `enumType("${name}"): must have at least one member.`,
      { meta: { enumName: name, reason: 'no-members' } },
    );
  }

  const seenNames = new Set<string>();
  const nameByValue = new Map<unknown, string>();
  for (const m of members) {
    if (seenNames.has(m.name)) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${name}"): duplicate member name "${m.name}". Member names must be unique.`,
        { meta: { enumName: name, member: m.name, reason: 'duplicate-member-name' } },
      );
    }
    seenNames.add(m.name);

    const earlier = nameByValue.get(m.value);
    if (earlier !== undefined) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${name}"): members "${earlier}" and "${m.name}" have the same value ${describeValue(m.value)}. Member values must be unique.`,
        {
          meta: { enumName: name, members: [earlier, m.name], reason: 'duplicate-member-value' },
        },
      );
    }
    nameByValue.set(m.value, m.name);
  }

  const values = Object.freeze(members.map((m) => m.value));
  const names = Object.freeze(members.map((m) => m.name));
  const enumMembers = Object.freeze(members.map((m) => ({ name: m.name, value: m.value })));

  const membersAccessor = Object.freeze(Object.fromEntries(members.map((m) => [m.name, m.value])));

  const valueSet = new Set(values);
  const valueToName = new Map(members.map((m) => [m.value, m.name]));
  const valueToOrdinal = new Map(values.map((v, i) => [v, i]));

  return {
    [ENUM_TYPE_HANDLE_BRAND]: true,
    enumName: name,
    codecId: codec.codecId,
    enumMembers,
    values,
    names,
    members: membersAccessor,
    has: (v: unknown) => valueSet.has(v),
    nameOf: (v: unknown) => valueToName.get(v),
    ordinalOf: (v: unknown) => valueToOrdinal.get(v) ?? -1,
  };
}

/**
 * Refuses two members of an `enumType` that store the same value, as `CONTRACT.ENUM_INVALID` naming both members and the stored value. `enumType` has no codec, so the contract build calls this once it has each member's stored form.
 */
export function assertEnumMembersStoredUniquely(
  enumName: string,
  members: readonly StoredEnumMember[],
): void {
  const [duplicate] = duplicateStoredMembers(members);
  if (duplicate === undefined) return;
  throw contractError(
    'CONTRACT.ENUM_INVALID',
    `enumType("${enumName}"): members "${duplicate.earlier}" and "${duplicate.later}" both store ${JSON.stringify(duplicate.stored)}. Member values must be unique as their codec stores them.`,
    {
      meta: {
        enumName,
        members: [duplicate.earlier, duplicate.later],
        reason: 'duplicate-member-value',
      },
    },
  );
}

/**
 * The signature of an `enumType` whose codec typemap is already bound — the
 * shape a target-bound wrapper (e.g. `@internal/postgres/contract-builder`)
 * exposes. The member values are constrained to the codec's input type drawn
 * from `CodecTypes`, while `Name`, `Codec`, and the member tuple still infer
 * from the call.
 */
export type BoundEnumType<CodecTypes extends CodecTypeMap> = <
  const Name extends string,
  const Codec extends Pick<ColumnTypeDescriptor, 'codecId'>,
  const Members extends readonly [
    EnumMember<string, CodecInput<CodecTypes, Codec>>,
    ...EnumMember<string, CodecInput<CodecTypes, Codec>>[],
  ],
>(
  name: Name,
  codec: Codec,
  ...members: Members
) => EnumTypeHandle<
  Name,
  MembersToValues<[...Members]>,
  MembersToNames<[...Members]>,
  MembersAccessorMap<[...Members]>
>;

/**
 * Bind `enumType` to a target's codec typemap. The returned function is the
 * same runtime `enumType`, retyped so member values are constrained to the
 * codec's input type. Target packages call this with their pack's
 * `ExtractCodecTypesFromPack<Pack>` to expose a codec-aware `enumType`.
 */
export function bindEnumType<CodecTypes extends CodecTypeMap>(): BoundEnumType<CodecTypes> {
  return enumType;
}

/**
 * Returns true when the value is an `EnumTypeHandle` produced by
 * `enumType()`. Used in the lowering pipeline to detect enum handles
 * in field state without importing the brand key at every call site.
 */
export function isEnumTypeHandle(value: unknown): value is EnumTypeHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, ENUM_TYPE_HANDLE_BRAND) === true
  );
}
