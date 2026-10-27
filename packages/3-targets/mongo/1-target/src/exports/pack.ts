import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import type { ControlMutationDefaults } from '@internal/framework-components/control';
import type { mongoAuthoringTypes } from '../core/authoring';
import { mongoTargetDescriptorMeta } from '../core/descriptor-meta';
import type { CodecTypes, ParameterizedOutputTypesForTypeParams } from './codec-types';

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
  readonly authoring: { readonly type: typeof mongoAuthoringTypes };
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly generatorFunctions: typeof mongoTargetDescriptorMeta.generatorFunctions;
  readonly __codecTypes?: CodecTypes;
  readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams;
} = mongoTargetDescriptorMeta;

export default mongoTargetPack;

// The types an application's exported contract names when it uses this pack, so its declaration output can name them through this entry.
export type { CodecTypes, ParameterizedOutputTypesForTypeParams, Vector } from './codec-types';
