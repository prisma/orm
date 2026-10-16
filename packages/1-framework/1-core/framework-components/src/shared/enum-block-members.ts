import type { JsonValue } from '@internal/contract/types';
import { isInternalError } from '@internal/utils/internal-error';
import { type Codec, readContractValue } from './codec';
import type { EnumMemberProblem } from './enum-members';
import { duplicateStoredMembers, type StoredEnumMember } from './enum-stored-members';
import type { AuthoringEntityContext } from './framework-authoring';
import type { ParsedPslExtensionBlock, PslSpan } from './psl-extension-block';

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
        message: `enum "${enumName}": members "${problem.earlier}" and "${problem.later}" both store ${JSON.stringify(problem.stored)}`,
        ...at(problem.later),
      };
  }
}

/**
 * Reads the members of an `enum` block through its codec. A member written as a number literal is read from its source text as a column default is read, when the family gives a reader for it (`ctx.readWrittenNumber`), so no digit is lost; when that reader refuses the number, the codec's data type and then the codec read it, and only if they refuse it too is the reader's reason reported. Every other member is read the same way, as a value of the codec's data type converted by `fromDataTypeValue`, and a bare member is read from its own name.
 * Pushes a diagnostic and returns `undefined` when the codec refuses a member, when two members
 * store the same value, or when the block has no members. Shared by every family's enum factory.
 */
export function readEnumBlockMembers(
  block: ParsedPslExtensionBlock<Readonly<Record<string, JsonValue | undefined>>>,
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
    const reading =
      typeof memberValue === 'number'
        ? ctx.readWrittenNumber?.({
            text: block.numberTexts?.[memberName] ?? String(memberValue),
            codecId,
            subject: `enum "${block.name}" member "${memberName}"`,
          })
        : undefined;
    const written = reading?.ok
      ? reading.value
      : memberValue === undefined
        ? memberName
        : memberValue;
    let read: unknown;
    try {
      read = readContractValue(codec, written, undefined);
    } catch (err) {
      if (isInternalError(err)) throw err;
      diagnostics?.push(
        reading !== undefined && !reading.ok
          ? { code: 'PSL_EXTENSION_INVALID_VALUE', message: reading.message, sourceId, span }
          : memberValue === undefined
            ? {
                code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
                message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
                sourceId,
                span,
              }
            : {
                code: 'PSL_EXTENSION_INVALID_VALUE',
                message: `enum "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${err instanceof Error ? err.message : String(err)}`,
                sourceId,
                span,
              },
      );
      memberError = true;
      continue;
    }

    members.push({ name: memberName, value: read });
    storedMembers.push({
      name: memberName,
      stored: codec.dataType.toContract(codec.toDataTypeValue(read)),
    });
  }

  for (const duplicate of duplicateStoredMembers(storedMembers)) {
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
