import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type ParsedPslExtensionBlock,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { type EnumTypeHandle, enumType } from '@internal/mongo-contract-ts/contract-builder';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, entriesBlock, jsonValue, str } from '@internal/psl-parser';

export function mongoFamilyEnumSpec() {
  return entriesBlock({
    value: {
      type: jsonValue(),
      documentation: 'The stored member value; a bare member stores its own name.',
    },
    allowBare: true,
  });
}

type EnumBlockValues = InferBlock<ReturnType<typeof mongoFamilyEnumSpec>>;

export const mongoFamilyEnumEntityDescriptor = {
  kind: 'entity' as const,
  discriminator: 'enum',
  output: {
    factory: (
      block: ParsedPslExtensionBlock<EnumBlockValues>,
      ctx: AuthoringEntityContext,
    ): EnumTypeHandle | undefined => {
      const sourceId = ctx.sourceId ?? 'unknown';
      const diagnostics = ctx.diagnostics;

      const resolved = resolveEnumCodecId(block, ctx);
      if (resolved === undefined) {
        return undefined;
      }
      const { codecId, codecSpan } = resolved;

      const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
      if (nativeType === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const codec = ctx.codecLookup?.get(codecId);
      if (codec === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" resolves in targetTypesFor but is absent from codecLookup.get`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const seenValues = new Set<string>();
      const members: { name: string; value: unknown }[] = [];
      let memberError = false;

      for (const [memberName, memberValue] of Object.entries(block.values)) {
        const span = block.parameterSpans[memberName] ?? block.span;
        let value: unknown;
        if (memberValue === undefined) {
          try {
            value = codec.decodeJson(memberName);
          } catch {
            diagnostics?.push({
              code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
              message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
              sourceId,
              span,
            });
            memberError = true;
            continue;
          }
        } else {
          try {
            value = codec.decodeJson(memberValue);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            diagnostics?.push({
              code: 'PSL_EXTENSION_INVALID_VALUE',
              message: `enum "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${reason}`,
              sourceId,
              span,
            });
            memberError = true;
            continue;
          }
        }

        const valueKey = String(value);
        if (seenValues.has(valueKey)) {
          diagnostics?.push({
            code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
            message: `enum "${block.name}": duplicate member value "${valueKey}"`,
            sourceId,
            span,
          });
          memberError = true;
          continue;
        }
        seenValues.add(valueKey);
        members.push({ name: memberName, value });
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

      return enumType(
        block.name,
        { codecId, nativeType },
        ...members.map((m) => ({ name: m.name, value: m.value })),
      );
    },
  },
} satisfies AuthoringEntityTypeDescriptor;

export const mongoFamilyEntityTypes: AuthoringEntityTypeNamespace = {
  enum: mongoFamilyEnumEntityDescriptor,
};

const enumTypeBlockAttribute = blockAttribute('type', {
  documentation: 'Selects the storage codec for this enum.',
  positional: [
    {
      key: 'codecId',
      type: str(),
      documentation: 'The fully qualified codec identifier used to store enum values.',
    },
  ],
});

export const mongoFamilyPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    documentation:
      'Defines an enum with named values and an inferred or explicitly selected storage codec.',
    discriminator: 'enum',
    name: { required: true },
    spec: mongoFamilyEnumSpec,
    attributes: { type: () => enumTypeBlockAttribute },
  } satisfies PslBlockSpecDescriptor,
} as const satisfies AuthoringPslBlockDescriptorNamespace;
