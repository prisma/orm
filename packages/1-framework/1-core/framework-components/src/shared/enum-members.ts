import type { JsonValue } from '@internal/contract/types';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { isInternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import { type Codec, readContractValue } from './codec';
import { enumRefusalOf } from './codec-descriptor';
import type { CodecLookupWithDescriptors } from './codec-types';
import { type DuplicateStoredValue, duplicateStoredMembers } from './enum-stored-members';

/** An enum whose members hold the values the application sees, before its codec stores them. */
export interface DecodedEnum {
  readonly codecId: string;
  readonly enumMembers: readonly { readonly name: string; readonly value: unknown }[];
}

/** An enum member as the contract holds it: in the form its codec stores. */
export interface EncodedEnumMember {
  readonly name: string;
  readonly value: JsonValue;
}

export interface CodecRefusedMember {
  readonly kind: 'codec-refused-member';
  readonly member: string;
  readonly reason: string;
  readonly cause: unknown;
}

export interface MemberNotStoredAsWritten {
  readonly kind: 'member-not-stored-as-written';
  readonly member: string;
  readonly written: string;
  readonly stored: JsonValue;
  readonly writeAs: string;
}

export type EnumMemberProblem =
  | { readonly kind: 'codec-not-for-enums'; readonly refusal: string }
  | { readonly kind: 'codec-missing' }
  | CodecRefusedMember
  | MemberNotStoredAsWritten
  | ({ readonly kind: 'duplicate-member-value' } & DuplicateStoredValue);

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
 * A member's value in the form its codec stores it, and that form read back by the codec. A codec that throws on either is a refusal naming the member; an internal error is not the member's fault and propagates.
 */
function encodeEnumMember(
  member: { readonly name: string; readonly value: unknown },
  codec: Codec,
): Result<{ readonly stored: JsonValue; readonly readBack: unknown }, CodecRefusedMember> {
  try {
    const stored = codec.dataType.toContract(codec.toDataTypeValue(member.value));
    return ok({ stored, readBack: readContractValue(codec, stored, undefined) });
  } catch (cause) {
    if (isInternalError(cause)) throw cause;
    return notOk({
      kind: 'codec-refused-member',
      member: member.name,
      reason: cause instanceof Error ? cause.message : String(cause),
      cause,
    });
  }
}

/**
 * Refuses a member its codec reads back as a different value from the one written. A member with no literal type has nothing to compare.
 */
function notStoredAsWritten(
  member: { readonly name: string; readonly value: unknown },
  stored: JsonValue,
  readBack: unknown,
): MemberNotStoredAsWritten | undefined {
  if (!hasLiteralType(member.value)) return undefined;
  if (hasLiteralType(readBack) && canonicalStringify(readBack) === canonicalStringify(member.value))
    return undefined;
  return {
    kind: 'member-not-stored-as-written',
    member: member.name,
    written: canonicalStringify(member.value),
    stored,
    writeAs: hasLiteralType(readBack) ? canonicalStringify(readBack) : JSON.stringify(stored),
  };
}

/**
 * Each member of an enum in the form its codec stores it. Refuses a codec an enum cannot use, a codec the lookup does not have, a member the codec refuses, a member the codec reads back as another value, and two members stored as the same value. Every family's contract build calls this, and reports the problems in its own terms.
 */
export function encodeEnumMembers(
  decodedEnum: DecodedEnum,
  codecLookup: CodecLookupWithDescriptors,
): Result<readonly EncodedEnumMember[], readonly EnumMemberProblem[]> {
  const descriptor = codecLookup.descriptorFor(decodedEnum.codecId);
  const refusal = descriptor === undefined ? undefined : enumRefusalOf(descriptor);
  if (refusal !== undefined) return notOk([{ kind: 'codec-not-for-enums', refusal }]);
  const codec = codecLookup.get(decodedEnum.codecId);
  if (codec === undefined) return notOk([{ kind: 'codec-missing' }]);

  const problems: EnumMemberProblem[] = [];
  const members: EncodedEnumMember[] = [];
  for (const member of decodedEnum.enumMembers) {
    const encoded = encodeEnumMember(member, codec);
    if (!encoded.ok) {
      problems.push(encoded.failure);
      continue;
    }
    const { stored, readBack } = encoded.value;
    const mismatch = notStoredAsWritten(member, stored, readBack);
    if (mismatch !== undefined) problems.push(mismatch);
    members.push({ name: member.name, value: stored });
  }
  for (const duplicate of duplicateStoredMembers(
    members.map(({ name, value }) => ({ name, stored: value })),
  )) {
    problems.push({ kind: 'duplicate-member-value', ...duplicate });
  }
  return problems.length > 0 ? notOk(problems) : ok(members);
}
