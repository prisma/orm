import type { SqlPslBuildContext } from '@internal/family-sql/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  type CodecDescriptorTemplate,
  createDataTypeLookup,
  type DataType,
} from '@internal/framework-components/codec';
import {
  assembleGeneratorFunctions,
  type GeneratorFunctionContribution,
} from '@internal/framework-components/components';
import { postgresAuthoringTypes } from '../../src/core/authoring';
import { type AnyPostgresCodecDescriptor, postgresCodec } from '../../src/core/codec-descriptor';
import { postgresDataTypeEntries } from '../../src/core/data-type-entries';
import { pgText, postgresDataTypes } from '../../src/core/data-types';
import { postgresTargetDescriptorMeta } from '../../src/core/descriptor-meta';
import { postgresCodecDescriptorRegistry } from '../../src/core/registry';
import { postgresScalarAndNativeTypeConstructors } from '../../src/core/type-constructors';

const citextTemplate: CodecDescriptorTemplate & { readonly jsonType: 'string' } = {
  jsonType: 'string',
  codecId: 'ext/citext@1',
  traits: [],
  paramsSchema: undefined,
  isParameterized: false,
  factory: () => () => {
    throw new Error('the printer never builds a codec');
  },
};

/** A codec the target does not own, as an extension would contribute it, representing text. */
export const extensionCodec: AnyPostgresCodecDescriptor = postgresCodec(citextTemplate, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
  factory: () => () => {
    throw new Error('the printer never builds a codec');
  },
});

/**
 * A stand-in for the stack the SQL family hands the printer: the family's and the target's own type constructors, codecs, data types and generator functions, the family's generator functions, and what `extra` adds.
 */
export function testBuildContext(
  extra: {
    readonly types?: AuthoringTypeNamespace;
    readonly generatorFunctions?: readonly GeneratorFunctionContribution[];
    readonly componentIdsByGenerator?: ReadonlyMap<string, string | undefined>;
    readonly codecs?: readonly AnyPostgresCodecDescriptor[];
    readonly dataTypes?: readonly DataType[];
  } = {},
): SqlPslBuildContext {
  const extraCodecs = new Map((extra.codecs ?? []).map((codec) => [codec.codecId, codec]));
  const descriptorFor = (codecId: string) =>
    extraCodecs.get(codecId) ?? postgresCodecDescriptorRegistry.descriptorFor(codecId);
  return {
    authoringContributions: {
      type: {
        ...sqlFamilyPack.authoring.type,
        ...postgresAuthoringTypes,
        ...postgresScalarAndNativeTypeConstructors,
        ...extra.types,
      },
    },
    generatorFunctions: assembleGeneratorFunctions([
      sqlFamilyPack,
      postgresTargetDescriptorMeta,
      {
        id: 'extension',
        generatorFunctions: extra.generatorFunctions ?? [],
        controlMutationDefaults: {
          generatorDescriptors: (extra.generatorFunctions ?? [])
            .flatMap(({ bindings }) => bindings.flatMap(({ generatorIds }) => generatorIds))
            .map((id) => ({ id })),
        },
      },
    ]),
    componentIdsByGenerator: extra.componentIdsByGenerator ?? new Map(),
    codecLookup: {
      get: () => undefined,
      renderOutputTypeFor: () => undefined,
      descriptorFor,
    },
    dataTypes: {
      entries: { ...sqlFamilyPack.authoring.dataTypes, ...postgresDataTypeEntries() },
      lookup: createDataTypeLookup([
        ...sqlFamilyPack.dataTypes,
        ...postgresDataTypes,
        ...(extra.dataTypes ?? []),
      ]),
      dataTypeOfCodec: (codecId) => descriptorFor(codecId)?.dataType,
    },
  };
}
