import type { CodecRegistry, DataTypeLookup } from '@internal/framework-components/codec';
import type { ComponentMetadata } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import { structuredError } from '@internal/utils/structured-error';
import {
  type AnyPostgresCodecDescriptor,
  buildPostgresCodecDescriptorRegistry,
  type PostgresCodecDescriptorRegistry,
} from './codec-descriptor';
import { createPostgresBuiltinDataTypeLookup } from './data-types';
import { postgresCodecDescriptorRegistry } from './registry';

export type PostgresCodecRegistry = CodecRegistry & PostgresCodecDescriptorRegistry;

type CodecContributor = Pick<ComponentMetadata, 'types'>;

/**
 * A registry of `descriptors`, refusing a codec whose data type `dataTypeLookup` does not have: the
 * SQL renderer writes a parameter's cast from the data type its codec represents.
 */
function buildPostgresCodecRegistry(
  descriptors: ReadonlyArray<unknown>,
  dataTypeLookup: Pick<DataTypeLookup, 'has'>,
): PostgresCodecRegistry {
  const descriptorRegistry = buildPostgresCodecDescriptorRegistry(descriptors);
  const validatedDescriptors = Array.from(descriptorRegistry.values());
  for (const descriptor of validatedDescriptors) {
    if (!dataTypeLookup.has(descriptor.dataType)) {
      throw structuredError(
        'CONTRACT.DATA_TYPE_UNREGISTERED',
        `Codec "${descriptor.codecId}" represents data type "${descriptor.dataType}", which no component registers.`,
        {
          why: 'A parameter of this codec is written with a cast named by its data type.',
          fix: 'Pass the data type beside the codec: in `dataTypes` of createPostgresAdapter, or in the `dataTypes` of the extension that contributes the codec.',
          meta: { codecId: descriptor.codecId, dataType: descriptor.dataType },
        },
      );
    }
  }
  const codecRegistry = extractCodecLookup([
    {
      id: 'postgres-codecs',
      types: { codecTypes: { codecDescriptors: validatedDescriptors } },
    },
  ]);
  const registry: PostgresCodecRegistry = {
    ...codecRegistry,
    descriptorFor: (codecId) => descriptorRegistry.descriptorFor(codecId),
    values: () => descriptorRegistry.values(),
  };
  return Object.freeze(registry);
}

export function assemblePostgresCodecRegistry(
  components: ReadonlyArray<CodecContributor>,
  dataTypeLookup: Pick<DataTypeLookup, 'has'>,
): PostgresCodecRegistry {
  const descriptors = components.flatMap(
    (component) => component.types?.codecTypes?.codecDescriptors ?? [],
  );
  return buildPostgresCodecRegistry(descriptors, dataTypeLookup);
}

export function assemblePostgresCodecRegistryWithBuiltins(
  extensions: ReadonlyArray<CodecContributor>,
  dataTypeLookup: Pick<DataTypeLookup, 'has'>,
): PostgresCodecRegistry {
  return buildPostgresCodecRegistry(
    [
      ...postgresCodecDescriptorRegistry.values(),
      ...extensions.flatMap((extension) => extension.types?.codecTypes?.codecDescriptors ?? []),
    ],
    dataTypeLookup,
  );
}

/** A registry of the built-in codecs and `codecDescriptors`, whose data types `dataTypeLookup` has. */
export function createPostgresCodecRegistryWithBuiltins(
  codecDescriptors: readonly AnyPostgresCodecDescriptor[] = [],
  dataTypeLookup: Pick<DataTypeLookup, 'has'> = createPostgresBuiltinDataTypeLookup(),
): PostgresCodecRegistry {
  return buildPostgresCodecRegistry(
    [...postgresCodecDescriptorRegistry.values(), ...codecDescriptors],
    dataTypeLookup,
  );
}

/**
 * Build a coherent PostgreSQL codec registry populated with built-in descriptors only.
 *
 * The returned registry supports both ordinary codec materialization and PostgreSQL target behavior. Stack-composed paths build the same combined registry from their complete ordered descriptor contributions.
 */
export function createPostgresBuiltinCodecLookup(): PostgresCodecRegistry {
  return createPostgresCodecRegistryWithBuiltins();
}
