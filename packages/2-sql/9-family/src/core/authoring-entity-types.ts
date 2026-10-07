import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type ParsedPslExtensionBlock,
  readEnumBlockMembers,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { requiredParamKeys } from '@internal/framework-components/codec';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, jsonValue, mapBlock, str } from '@internal/psl-parser';
import { type EnumTypeHandle, enumType } from '@internal/sql-contract-ts/contract-builder';

export function sqlFamilyEnumSpec() {
  return mapBlock({
    value: {
      type: jsonValue(),
      documentation: 'The stored member value; a bare member stores its own name.',
    },
    allowBare: true,
  });
}

type EnumBlockValues = InferBlock<ReturnType<typeof sqlFamilyEnumSpec>>;

export const sqlFamilyEnumEntityDescriptor = {
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
      const codec = ctx.codecLookup.get(codecId);
      if (descriptor === undefined || codec === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }
      if (descriptor.enumRefusal !== undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" cannot use the codec "${codecId}". ${descriptor.enumRefusal}`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }
      const dataType = ctx.dataTypeLookup.get(descriptor.dataType);
      if (dataType === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" represents data type "${descriptor.dataType}", which no component registers`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const [requiredParam] = requiredParamKeys(dataType);
      if (requiredParam !== undefined) {
        diagnostics?.push({
          code: 'PSL_ENUM_TYPE_NEEDS_PARAMETERS',
          message: `enum "${block.name}" @@type codec "${codecId}" represents data type "${dataType.id}", which requires the parameter "${requiredParam}"; an enum block gives it none`,
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

export const sqlFamilyEntityTypes: AuthoringEntityTypeNamespace = {
  enum: sqlFamilyEnumEntityDescriptor,
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

export const sqlFamilyPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    documentation:
      'Defines an enum with named values and an inferred or explicitly selected storage codec.',
    discriminator: 'enum',
    name: { required: true },
    spec: sqlFamilyEnumSpec,
    attributes: { type: () => enumTypeBlockAttribute },
  } satisfies PslBlockSpecDescriptor,
} as const satisfies AuthoringPslBlockDescriptorNamespace;
