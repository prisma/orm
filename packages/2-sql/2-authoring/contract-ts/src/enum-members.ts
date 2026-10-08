import type { JsonValue, ValueSetRef } from '@internal/contract/types';
import type { EnumTypeHandle } from '@internal/contract-authoring';
import {
  type Codec,
  type CodecLookupWithDescriptors,
  enumRefusalOf,
} from '@internal/framework-components/codec';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { InternalError } from '@internal/utils/internal-error';
import { encodeViaCodec } from './column-defaults';
import { contractError } from './contract-errors';

/** Whether TypeScript gives the value a literal type: a primitive, or an array or plain object of them. */
function hasLiteralType(value: unknown): boolean {
  if (['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(hasLiteralType);
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(hasLiteralType)
  );
}

/**
 * Refuses a member whose codec reads its stored value back as a different value from the one written.
 * The contract's types name the member as written, while the runtime reads the stored value, so the
 * two must be the same value. A member with no literal type has nothing to contradict. The caller
 * has already read the stored value back once, so the codec takes it.
 */
function assertStoredAsWritten(
  enumName: string,
  member: { readonly name: string; readonly value: unknown },
  stored: JsonValue,
  codec: Codec,
): void {
  if (!hasLiteralType(member.value)) return;
  const readBack = codec.decodeJson(stored);
  if (
    hasLiteralType(readBack) &&
    canonicalStringify(readBack) === canonicalStringify(member.value)
  ) {
    return;
  }
  const writeAs = hasLiteralType(readBack) ? canonicalStringify(readBack) : JSON.stringify(stored);
  throw contractError(
    'CONTRACT.ENUM_INVALID',
    `enumType("${enumName}"): member "${member.name}" is written ${canonicalStringify(member.value)}, but the column stores ${JSON.stringify(stored)}. Write the member as ${writeAs}.`,
    { meta: { enumName, member: member.name, reason: 'member-not-stored-as-written' } },
  );
}

/** A member's value in the form the enum's codec stores it. A member the codec refuses is a `CONTRACT.ENUM_INVALID` naming the enum and the member. */
function encodeEnumMember(
  handle: EnumTypeHandle,
  member: { readonly name: string; readonly value: unknown },
  codec: Codec | undefined,
): JsonValue {
  try {
    return encodeViaCodec(member.value, codec);
  } catch (cause) {
    if (cause instanceof InternalError) throw cause;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw contractError(
      'CONTRACT.ENUM_INVALID',
      `enumType("${handle.enumName}") member "${member.name}" has a value its codec ${handle.codecId} refuses: ${reason}`,
      {
        fix: 'Give the member a value the codec takes, or type the enum with a codec that takes it.',
        cause,
        meta: {
          enumName: handle.enumName,
          member: member.name,
          codecId: handle.codecId,
          reason: 'codec-refused-member',
        },
      },
    );
  }
}

/**
 * Each member's value in the form the enum's codec stores it, read back by the codec. A codec an
 * enum cannot use, a member the codec refuses, a member written differently from how it is stored,
 * and two members that store the same value are each a `CONTRACT.ENUM_INVALID`.
 */
export function encodeEnumMembers(
  handle: EnumTypeHandle,
  codecLookup: CodecLookupWithDescriptors,
): readonly { readonly name: string; readonly value: JsonValue }[] {
  const descriptor = codecLookup.descriptorFor(handle.codecId);
  const enumRefusal = descriptor === undefined ? undefined : enumRefusalOf(descriptor);
  if (enumRefusal !== undefined) {
    throw contractError(
      'CONTRACT.ENUM_INVALID',
      `enumType("${handle.enumName}"): an enum cannot use the codec ${handle.codecId}. ${enumRefusal}`,
      {
        fix: 'Type the enum with another codec.',
        meta: { enumName: handle.enumName, codecId: handle.codecId, reason: 'codec-not-for-enums' },
      },
    );
  }
  const codec = codecLookup.get(handle.codecId);
  const memberByStoredValue = new Map<string, string>();
  return handle.enumMembers.map((member) => {
    const value = encodeEnumMember(handle, member, codec);
    if (codec !== undefined) assertStoredAsWritten(handle.enumName, member, value, codec);
    const key = canonicalStringify(value);
    const earlier = memberByStoredValue.get(key);
    if (earlier !== undefined) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${handle.enumName}"): members "${earlier}" and "${member.name}" both store ${JSON.stringify(value)}. Member values must be unique as the column stores them.`,
        {
          meta: {
            enumName: handle.enumName,
            members: [earlier, member.name],
            reason: 'duplicate-member-value',
          },
        },
      );
    }
    memberByStoredValue.set(key, member.name);
    return { name: member.name, value };
  });
}

/**
 * The member values a membership check must enforce, encoded exactly as the
 * column stores them. Membership predicates support strings and finite numbers.
 */
export function checkMemberValues(
  handle: EnumTypeHandle,
  codecLookup: CodecLookupWithDescriptors,
): readonly (string | number)[] {
  const encoded = encodeEnumMembers(handle, codecLookup).map((member) => member.value);
  const values: (string | number)[] = [];
  for (const value of encoded) {
    if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${handle.enumName}"): CHECK constraint members must encode to strings or finite numbers.`,
        { meta: { enumName: handle.enumName, reason: 'unsupported-member-value' } },
      );
    }
    values.push(value);
  }
  return values;
}

export interface EnumValueSetRefs {
  readonly domain: ValueSetRef;
  readonly storage: ValueSetRef;
}

/**
 * The refs of a field typed by an authored enum: the domain enum and its storage value set. Authored enums are registered in the default namespace, whatever namespace the field's model is in.
 */
export function enumValueSetRefs(
  enumHandle: EnumTypeHandle | undefined,
  defaultNamespaceId: string,
): EnumValueSetRefs | undefined {
  if (enumHandle === undefined) return undefined;
  const common = { namespaceId: defaultNamespaceId, entityName: enumHandle.enumName };
  return {
    domain: { plane: 'domain', entityKind: 'enum', ...common },
    storage: { plane: 'storage', entityKind: 'valueSet', ...common },
  };
}
