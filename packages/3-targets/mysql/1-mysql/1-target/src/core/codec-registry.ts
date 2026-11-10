import type { CodecRegistry } from '@internal/framework-components/codec';
import type { ComponentMetadata } from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import {
  buildMysqlCodecDescriptorRegistry,
  type MysqlCodecDescriptorRegistry,
} from './codec-descriptor';
import { mysqlCodecDescriptorRegistry } from './registry';

type CodecContributor = Pick<ComponentMetadata, 'types'>;

function descriptorsFrom(contributors: ReadonlyArray<CodecContributor>): readonly unknown[] {
  return contributors.flatMap(
    (contributor) => contributor.types?.codecTypes?.codecDescriptors ?? [],
  );
}

export type MysqlCodecRegistry = CodecRegistry & MysqlCodecDescriptorRegistry;

function buildMysqlCodecRegistry(descriptors: ReadonlyArray<unknown>): MysqlCodecRegistry {
  const descriptorRegistry = buildMysqlCodecDescriptorRegistry(descriptors);
  const codecRegistry = extractCodecLookup([
    {
      id: 'mysql-codecs',
      types: { codecTypes: { codecDescriptors: Array.from(descriptorRegistry.values()) } },
    },
  ]);
  const registry: MysqlCodecRegistry = {
    ...codecRegistry,
    descriptorFor: (codecId) => descriptorRegistry.descriptorFor(codecId),
    values: () => descriptorRegistry.values(),
  };
  return Object.freeze(registry);
}

/** The codec registry of a MySQL stack: the target's built-in codecs and those its extensions contribute. */
export function assembleMysqlCodecRegistry(
  target: CodecContributor,
  extensions: ReadonlyArray<CodecContributor>,
): MysqlCodecRegistry {
  return buildMysqlCodecRegistry([
    ...descriptorsFrom([target]),
    ...mysqlCodecDescriptorRegistry.values(),
    ...descriptorsFrom(extensions),
  ]);
}

/** A codec registry of the MySQL built-in codecs only. */
export function createMysqlBuiltinCodecLookup(): MysqlCodecRegistry {
  return buildMysqlCodecRegistry([...mysqlCodecDescriptorRegistry.values()]);
}
