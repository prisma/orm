import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { buildMysqlCodecDescriptorRegistry } from './codec-descriptor';
import { codecDescriptors } from './codecs';

/** Every codec descriptor `@internal/target-mysql` ships, for consumers that enumerate or look up a MySQL codec by id. ADR 208. */
export const mysqlCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);

export const mysqlCodecDescriptorRegistry = buildMysqlCodecDescriptorRegistry(codecDescriptors);
