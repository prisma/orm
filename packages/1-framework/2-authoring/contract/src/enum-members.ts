import { errorEnumCodecNotInPackStack } from '@internal/errors/control';
import {
  type EncodedEnumMember,
  type EnumMemberProblem,
  encodeEnumMembers,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { assertDefined } from '@internal/utils/assertions';
import type { StructuredError } from '@internal/utils/structured-error';
import { contractError } from './contract-errors';
import { duplicateMemberError, type EnumTypeHandle } from './enum-type';

/** The `CONTRACT.*` error for one problem `encodeEnumMembers` finds, worded for `enumType`. */
export function enumMemberError(
  handle: Pick<EnumTypeHandle, 'enumName' | 'codecId'>,
  problem: EnumMemberProblem,
  storedBy: string,
): StructuredError {
  const { enumName, codecId } = handle;
  switch (problem.kind) {
    case 'codec-not-for-enums':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${enumName}"): an enum cannot use the codec ${codecId}. ${problem.refusal}`,
        {
          fix: 'Type the enum with another codec.',
          meta: { enumName, codecId, reason: 'codec-not-for-enums' },
        },
      );
    case 'codec-missing':
      return errorEnumCodecNotInPackStack({ codecId });
    case 'codec-refused-member':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${enumName}") member "${problem.member}" has a value its codec ${codecId} refuses: ${problem.reason}`,
        {
          fix: 'Give the member a value the codec takes, or type the enum with a codec that takes it.',
          cause: problem.cause,
          meta: { enumName, member: problem.member, codecId, reason: 'codec-refused-member' },
        },
      );
    case 'member-not-stored-as-written':
      return contractError(
        'CONTRACT.ENUM_INVALID',
        `enumType("${enumName}"): member "${problem.member}" is written ${problem.written}, but ${storedBy} stores ${JSON.stringify(problem.stored)}. Write the member as ${problem.writeAs}.`,
        { meta: { enumName, member: problem.member, reason: 'member-not-stored-as-written' } },
      );
    case 'duplicate-member-value':
      return duplicateMemberError(enumName, problem);
  }
}

/**
 * Each member of an `enumType` in the form its codec stores it, which is how the contract holds it. Throws the first problem `encodeEnumMembers` finds: `CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK` for a codec no pack provides, and `CONTRACT.ENUM_INVALID` for the others. `storedBy` names what stores the value in the family's terms, such as `the column`.
 */
export function encodeEnumTypeMembers(
  handle: EnumTypeHandle,
  codecLookup: CodecLookupWithDescriptors,
  storedBy: string,
): readonly EncodedEnumMember[] {
  const encoded = encodeEnumMembers(handle, codecLookup);
  if (encoded.ok) return encoded.value;
  const [problem] = encoded.failure;
  assertDefined(problem, 'encodeEnumMembers fails with at least one problem');
  throw enumMemberError(handle, problem, storedBy);
}
