import type { JsonValue } from '@internal/contract/types';
import { isInternalError } from '@internal/utils/internal-error';
import type { Codec } from './codec';
import { duplicateStoredMembers, type StoredEnumMember } from './enum-stored-members';
import type { AuthoringEntityContext } from './framework-authoring';
import type { ParsedPslExtensionBlock } from './psl-extension-block';

export interface EnumBlockMember {
  readonly name: string;
  readonly value: unknown;
}

/**
 * Reads the members of an `enum` block through its codec. A member written as a number literal is read from its source text as a column default is read, when the family gives a reader for it (`ctx.readWrittenNumber`), so no digit is lost; when that reader refuses the number, the codec's `decodeJson` reads it, and only if the codec refuses it too is the reader's reason reported. Every other member goes to the codec's `decodeJson`, and a bare member is read from its own name.
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
      read = codec.decodeJson(written);
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
    storedMembers.push({ name: memberName, stored: codec.encodeJson(read) });
  }

  for (const { earlier, later, stored } of duplicateStoredMembers(storedMembers)) {
    diagnostics?.push({
      code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
      message: `enum "${block.name}": members "${earlier}" and "${later}" both store ${JSON.stringify(stored)}`,
      sourceId,
      span: block.parameterSpans[later] ?? block.span,
    });
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
