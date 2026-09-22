import { mongoCodecDescriptors } from '@internal/adapter-mongo/codecs';
import { mongoDataTypes } from '@internal/adapter-mongo/data-types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecTypes } from './codec-types';

// The Mongo target owns its codec descriptors. Contract authoring resolves each enum's codec by id
// from this list (via `extractCodecLookup`) to encode member values, so the target pack is the sole
// contributor of these codecs to the composed control stack.
const mongoTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'mongo',
  targetId: 'mongo',
  id: 'mongo',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  supportsNamespaces: true,
  dataTypes: mongoDataTypes,
  types: {
    codecTypes: {
      codecDescriptors: mongoCodecDescriptors,
    },
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMetaBase;
