import type { SqlPslBuildContext } from '@internal/family-sql/control';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  type CodecDescriptorTemplate,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import { postgresAuthoringTypes } from '../../src/core/authoring';
import { type AnyPostgresCodecDescriptor, postgresCodec } from '../../src/core/codec-descriptor';
import { postgresDataTypeEntries } from '../../src/core/data-type-entries';
import { pgText, postgresDataTypes } from '../../src/core/data-types';
import { postgresCodecDescriptorRegistry } from '../../src/core/registry';
import {
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../../src/core/type-constructors';

const citextTemplate: CodecDescriptorTemplate = {
  codecId: 'ext/citext@1',
  traits: [],
  targetTypes: ['citext'],
  paramsSchema: undefined,
  isParameterized: false,
  factory: () => () => {
    throw new Error('the printer never builds a codec');
  },
};

/** A codec the target does not own, as an extension would contribute it: text stored as `citext`. */
export const extensionCodec: AnyPostgresCodecDescriptor = postgresCodec(citextTemplate, {
  dataType: pgText.id,
  nativeType: () => 'citext',
  jsonProjection: (expression) => expression,
});

/**
 * A stand-in for the stack the SQL family hands the printer: the target's own type constructors,
 * codecs and data types, the type constructors the adapter contributes, and what `extra` adds.
 */
export function testBuildContext(
  extra: {
    readonly types?: AuthoringTypeNamespace;
    readonly codecs?: readonly AnyPostgresCodecDescriptor[];
  } = {},
): SqlPslBuildContext {
  const extraCodecs = new Map((extra.codecs ?? []).map((codec) => [codec.codecId, codec]));
  return {
    authoringContributions: {
      type: {
        ...postgresAuthoringTypes,
        ...postgresScalarAuthoringTypes,
        ...postgresNativeAuthoringTypes,
        ...extra.types,
      },
      dataTypes: postgresDataTypeEntries(),
    },
    codecLookup: {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => undefined,
      descriptorFor: (codecId) =>
        extraCodecs.get(codecId) ?? postgresCodecDescriptorRegistry.descriptorFor(codecId),
    },
    dataTypeLookup: createDataTypeLookup(postgresDataTypes),
  };
}
