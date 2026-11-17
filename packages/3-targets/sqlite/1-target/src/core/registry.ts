import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { buildSqliteCodecDescriptorRegistry } from './codec-descriptor';
import { codecDescriptors } from './codecs';

/**
 * Registry of every codec descriptor shipped by `@internal/target-sqlite`.
 *
 * Public consumer surface for the sqlite codec set: the sqlite adapter and any other consumer that needs to enumerate or look up a sqlite codec by id consumes this rather than the raw descriptor array. See ADR 208.
 */
export const sqliteCodecRegistry: CodecDescriptorRegistry =
  buildCodecDescriptorRegistry(codecDescriptors);

export const sqliteCodecDescriptorRegistry = buildSqliteCodecDescriptorRegistry(codecDescriptors);
