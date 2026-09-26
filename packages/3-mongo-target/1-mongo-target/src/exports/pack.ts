import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type { ControlMutationDefaults } from '@internal/framework-components/control';
import type { mongoAuthoringFieldPresets } from '../core/authoring';
import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';
import type { CodecTypes } from './codec-types';

const mongoTargetPack: {
  readonly kind: 'target';
  readonly familyId: 'mongo';
  readonly targetId: 'mongo';
  readonly id: 'mongo';
  readonly version: '0.0.1';
  readonly capabilities: Record<string, never>;
  readonly defaultNamespaceId: '__unbound__';
  readonly types: {
    readonly codecTypes: { readonly codecDescriptors: ReadonlyArray<AnyCodecDescriptor> };
  };
  readonly authoring: { readonly field: typeof mongoAuthoringFieldPresets };
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMeta;

export default mongoTargetPack;
