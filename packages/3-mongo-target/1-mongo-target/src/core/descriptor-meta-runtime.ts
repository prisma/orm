import type { TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecTypes } from '../exports/codec-types';
import { mongoCodecDescriptors } from './codecs';
import { mongoDataTypes } from './data-types';

// The runtime descriptor spreads this slice only. Authoring contributions and the control-plane
// generator descriptors live in `./descriptor-meta`, which the pack and the control descriptor use.
//
// The Mongo target owns its codec descriptors. Contract authoring resolves each enum's codec by id
// from this list (via `extractCodecLookup`) to encode member values, so the target pack is the sole
// contributor of these codecs to the composed control stack.
const mongoTargetDescriptorMetaRuntimeBase = {
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

export const mongoTargetDescriptorMetaRuntime: typeof mongoTargetDescriptorMetaRuntimeBase & {
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMetaRuntimeBase;
