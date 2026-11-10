import type { AnyPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { createPostgresAdapter } from '../src/core/adapter';

declare const descriptor: AnyPostgresCodecDescriptor;

createPostgresAdapter({ codecDescriptors: [descriptor] });

createPostgresAdapter({
  // @ts-expect-error Generic codec lookups cannot be injected independently from target descriptors.
  codecLookup: undefined,
});

createPostgresAdapter({
  // @ts-expect-error Target descriptor registries cannot be injected independently from materialization.
  codecDescriptorRegistry: undefined,
});
