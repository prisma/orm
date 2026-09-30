import type { CodecRegistry } from '@internal/framework-components/codec';
import type { ComponentMetadata } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import {
  type AnyPostgresCodecDescriptor,
  buildPostgresCodecDescriptorRegistry,
  type PostgresCodecDescriptorRegistry,
} from './codec-descriptor';
import { postgresCodecDescriptorRegistry } from './registry';

export type PostgresCodecRegistry = CodecRegistry & PostgresCodecDescriptorRegistry;

function buildPostgresCodecRegistry(descriptors: ReadonlyArray<unknown>): PostgresCodecRegistry {
  const descriptorRegistry = buildPostgresCodecDescriptorRegistry(descriptors);
  const validatedDescriptors = Array.from(descriptorRegistry.values());
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
  components: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): PostgresCodecRegistry {
  const descriptors = components.flatMap(
    (component) => component.types?.codecTypes?.codecDescriptors ?? [],
  );
  return buildPostgresCodecRegistry(descriptors);
}

export function assemblePostgresCodecRegistryWithBuiltins(
  extensions: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): PostgresCodecRegistry {
  return buildPostgresCodecRegistry([
    ...postgresCodecDescriptorRegistry.values(),
    ...extensions.flatMap((extension) => extension.types?.codecTypes?.codecDescriptors ?? []),
  ]);
}

export function createPostgresCodecRegistryWithBuiltins(
  codecDescriptors: readonly AnyPostgresCodecDescriptor[] = [],
): PostgresCodecRegistry {
  return buildPostgresCodecRegistry([
    ...postgresCodecDescriptorRegistry.values(),
    ...codecDescriptors,
  ]);
}

/**
 * Build a coherent PostgreSQL codec registry populated with built-in descriptors only.
 *
 * The returned registry supports both ordinary codec materialization and PostgreSQL target behavior. Stack-composed paths build the same combined registry from their complete ordered descriptor contributions.
 */
export function createPostgresBuiltinCodecLookup(): PostgresCodecRegistry {
  return createPostgresCodecRegistryWithBuiltins();
}
