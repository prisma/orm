import { InternalError } from '@internal/utils/internal-error';
import { type Codec, readContractValue } from './codec';
import type { EnumMemberProblem } from './enum-members';
import { duplicateStoredMembers, type StoredEnumMember } from './enum-stored-members';
import type { AuthoringEntityContext } from './framework-authoring';
import type { ParsedPslExtensionBlock, PslSpan } from './psl-extension-block';
import { readWrittenValueIntoCodec, type WrittenValue } from './written-value';

export interface EnumBlockMember {
  readonly name: string;
  readonly value: unknown;
}

export interface EnumBlockDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}

/**
 * Where an `enum` block is written: the source, the block's span, and each member's span.
 */
export interface EnumBlockSite {
  readonly enumName: string;
  readonly codecId: string;
  readonly sourceId: string;
  readonly span: PslSpan;
  readonly memberSpans: Readonly<Record<string, PslSpan>>;
}

/**
 * A problem with an enum's members as a diagnostic at the member, or at the block when the problem is the enum's codec.
 */
export function enumMemberProblemDiagnostic(
  problem: EnumMemberProblem,
  site: EnumBlockSite,
): EnumBlockDiagnostic {
  const { enumName, codecId, sourceId } = site;
  const at = (member: string) => ({ sourceId, span: site.memberSpans[member] ?? site.span });
  switch (problem.kind) {
    case 'codec-not-for-enums':
      return {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `enum "${enumName}" cannot use the codec "${codecId}". ${problem.refusal}`,
        sourceId,
        span: site.span,
      };
    case 'codec-missing':
      return {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `enum "${enumName}" uses codec "${codecId}", which no pack in the contract provides`,
        sourceId,
        span: site.span,
      };
    case 'codec-refused-member':
      return {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `enum "${enumName}" member "${problem.member}" was rejected by codec "${codecId}": ${problem.reason}`,
        ...at(problem.member),
      };
    case 'member-not-stored-as-written':
      return {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: `enum "${enumName}" member "${problem.member}" is written ${problem.written}, but its codec stores ${JSON.stringify(problem.stored)}. Write the member as ${problem.writeAs}.`,
        ...at(problem.member),
      };
    case 'duplicate-member-value':
      return {
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message:
          problem.earlierStored === undefined
            ? `enum "${enumName}": members "${problem.earlier}" and "${problem.later}" both store ${JSON.stringify(problem.stored)}`
            : `enum "${enumName}": members "${problem.earlier}" and "${problem.later}" store ${JSON.stringify(problem.earlierStored)} and ${JSON.stringify(problem.stored)}, which the database holds equal`,
        ...at(problem.later),
      };
  }
}

/** A member as it is written: its recorded written value, or a bare member's name, as text. */
function writtenMember(
  block: ParsedPslExtensionBlock<Readonly<Record<string, unknown>>>,
  memberName: string,
  memberValue: unknown,
): WrittenValue {
  const written = block.writtenValues?.[memberName];
  if (written !== undefined) return written;
  if (memberValue === undefined) return { kind: 'string', text: memberName };
  throw new InternalError(
    `enum "${block.name}" member "${memberName}" has a value, but the block holds no written value for it.`,
  );
}

/**
 * Reads the members of an `enum` block through its codec with {@link readWrittenValueIntoCodec}: each member's syntax gives it a data type, the codec's data type takes it directly or through a cast, and the codec checks it, so a number keeps every digit and a quoted value is text. A bare member is read from its own name, as text.
 * Pushes a diagnostic and returns `undefined` when a member is refused, when two members
 * store the same value, or when the block has no members. Shared by every family's enum factory.
 */
export function readEnumBlockMembers(
  block: ParsedPslExtensionBlock<Readonly<Record<string, unknown>>>,
  codecId: string,
  codec: Codec,
  ctx: AuthoringEntityContext,
): readonly EnumBlockMember[] | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;
  const site: EnumBlockSite = {
    enumName: block.name,
    codecId,
    sourceId,
    span: block.span,
    memberSpans: block.parameterSpans,
  };
  const members: EnumBlockMember[] = [];
  const storedMembers: StoredEnumMember[] = [];
  let memberError = false;

  for (const [memberName, memberValue] of Object.entries(block.values)) {
    const span = block.parameterSpans[memberName] ?? block.span;
    const reading = readWrittenValueIntoCodec({
      support: ctx.dataTypes,
      codecLookup: ctx.codecLookup,
      ref: { codecId },
      written: writtenMember(block, memberName, memberValue),
      subject: `enum "${block.name}" member "${memberName}"`,
    });
    if (!reading.ok) {
      diagnostics?.push(
        memberValue === undefined
          ? {
              code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
              message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
              sourceId,
              span,
            }
          : { ...reading.failure, sourceId, span },
      );
      memberError = true;
      continue;
    }
    const read = readContractValue(codec, reading.value, undefined);
    members.push({ name: memberName, value: read });
    storedMembers.push({
      name: memberName,
      stored: codec.dataType.toContract(codec.toDataTypeValue(read)),
    });
  }

  for (const duplicate of duplicateStoredMembers(storedMembers, codec.dataType.equalityKey)) {
    diagnostics?.push(
      enumMemberProblemDiagnostic({ kind: 'duplicate-member-value', ...duplicate }, site),
    );
    memberError = true;
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }
  return members;
}
