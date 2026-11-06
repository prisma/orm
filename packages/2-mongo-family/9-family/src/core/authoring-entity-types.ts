import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type ParsedPslExtensionBlock,
  readEnumBlockMembers,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { enumRefusalOf } from '@internal/framework-components/codec';
import { type EnumTypeHandle, enumType } from '@internal/mongo-contract-ts/contract-builder';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, enumMemberValue, mapBlock, str } from '@internal/psl-parser';

export function mongoFamilyEnumSpec() {
  return mapBlock({
    value: {
      type: enumMemberValue(),
      documentation:
        "The member's value, written as a value of the enum's data type; a bare member stores its own name.",
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

      const descriptor = ctx.codecLookup.descriptorFor(codecId);
      if (descriptor === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }
      const enumRefusal = enumRefusalOf(descriptor);
      if (enumRefusal !== undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" cannot use the codec "${codecId}". ${enumRefusal}`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const codec = ctx.codecLookup.get(codecId);
      if (codec === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" is registered but codecLookup.get has no codec for it`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const members = readEnumBlockMembers(block, codecId, codec, ctx);
      if (members === undefined) return undefined;

      return enumType(block.name, { codecId }, ...members);
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
