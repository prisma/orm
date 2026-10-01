import type { CodecRegistry } from '@internal/framework-components/codec';
import type { AnySqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import type { SqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { createSqliteAdapter } from '../src/core/adapter';
import { SqliteControlAdapter } from '../src/core/control-adapter';

declare const descriptor: AnySqliteCodecDescriptor;
declare const coherentRegistry: SqliteCodecRegistry;
declare const genericRegistry: CodecRegistry;

createSqliteAdapter({ codecDescriptors: [descriptor] });
new SqliteControlAdapter(coherentRegistry);

createSqliteAdapter({
  // @ts-expect-error Generic codec lookups cannot be injected independently from target descriptors.
  codecLookup: undefined,
});

createSqliteAdapter({
  // @ts-expect-error Target descriptor registries cannot be injected independently from materialization.
  codecDescriptorRegistry: undefined,
});

// @ts-expect-error Control construction requires one coherent ordinary and target-specific registry.
new SqliteControlAdapter(genericRegistry);
