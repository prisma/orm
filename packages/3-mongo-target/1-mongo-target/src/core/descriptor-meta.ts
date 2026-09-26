import type { TargetPackRef } from '@internal/framework-components/components';
import { timestampNowControlDescriptor } from '@internal/framework-components/control';
import type { CodecTypes } from '../exports/codec-types';
import { mongoAuthoringFieldPresets } from './authoring';
import { mongoTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const mongoTargetDescriptorMetaBase = {
  ...mongoTargetDescriptorMetaRuntime,
  authoring: {
    field: mongoAuthoringFieldPresets,
  },
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [timestampNowControlDescriptor()],
  },
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = mongoTargetDescriptorMetaBase;
