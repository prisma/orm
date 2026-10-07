import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type ParsedPslExtensionBlock,
  readEnumBlockMembers,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { isMongoDataType } from '@internal/mongo-contract/data-type';
import { type EnumTypeHandle, enumType } from '@internal/mongo-contract-ts/contract-builder';
import type { InferBlock, PslBlockSpecDescriptor } from '@internal/psl-parser';
import { blockAttribute, jsonValue, mapBlock, str } from '@internal/psl-parser';
import { InternalError } from '@internal/utils/internal-error';

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

/**
 * A collection validator lists an enum's members in their stored forms, so an enum's BSON type must be one whose values JSON holds. Maps each such type to the JSON type of a member's stored form.
 */
const VALIDATOR_LISTABLE_BSON_TYPES: Readonly<
  Record<string, 'string' | 'number' | 'boolean' | 'object'>
> = {
  string: 'string',
  int: 'number',
  double: 'number',
  bool: 'boolean',
  object: 'object',
  array: 'object',
};

const STORED_JSON_TYPE_NAMES = {
  string: 'a string',
  number: 'a finite number',
  boolean: 'a boolean',
  object: 'a JSON object or array',
} as const;

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
      if (!isMongoDataType(dataType)) {
        throw new InternalError(`Data type ${dataType.id} is not a Mongo data type.`);
      }
      const { bsonTypes } = dataType.mongo;
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

      const storedJsonType = VALIDATOR_LISTABLE_BSON_TYPES[bsonType];
      if (storedJsonType === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" stores BSON type ${bsonType}, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.`,
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

      let unlistedMember = false;
      for (const member of members) {
        const stored = codec.encodeJson(member.value);
        if (typeof stored === storedJsonType) continue;
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" member "${member.name}" is stored as ${JSON.stringify(stored)}, which a collection validator cannot list as a ${bsonType}. A member of a ${bsonType} enum must be ${STORED_JSON_TYPE_NAMES[storedJsonType]}.`,
          sourceId,
          span: block.parameterSpans[member.name] ?? block.span,
        });
        unlistedMember = true;
      }
      if (unlistedMember) return undefined;

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
