import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { buildPostgresCodecDescriptorRegistry } from './codec-descriptor';
import { codecDescriptors } from './codecs';

/**
 * Registry of every codec descriptor shipped by `@internal/target-postgres`.
 *
 * Public consumer surface for the postgres codec set: the postgres adapter and any other consumer that needs to enumerate or look up a postgres codec by id consumes this rather than the raw descriptor array. See ADR 208.
 */
export const postgresCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);

export const postgresCodecDescriptorRegistry =
  buildPostgresCodecDescriptorRegistry(codecDescriptors);
