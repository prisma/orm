import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type ParsedPslExtensionBlock,
  readEnumBlockMembers,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { type EnumTypeHandle, enumType } from '@internal/mongo-contract-ts/contract-builder';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, jsonValue, mapBlock, str } from '@internal/psl-parser';

export function mongoFamilyEnumSpec() {
  return mapBlock({
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

      const bsonTypes = ctx.codecLookup?.targetTypesFor(codecId);
      if (bsonTypes === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }
      const [bsonType, ...otherBsonTypes] = bsonTypes;
      if (bsonType === undefined || otherBsonTypes.length > 0) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" declares ${bsonTypes.length} BSON types; an enum needs exactly one. Use a codec with one BSON type, such as mongo/string@1.`,
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

      const members = readEnumBlockMembers(block, codecId, codec, ctx);
      if (members === undefined) return undefined;

      return enumType(block.name, { codecId, nativeType: bsonType }, ...members);
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
