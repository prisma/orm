import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import {
  singleGeneratorBinding,
  type TargetPackRef,
} from '@internal/framework-components/components';
import type { CodecTypes, ParameterizedOutputTypesForTypeParams } from '../exports/codec-types';
import { mongoAuthoringTypes } from './authoring';
import { mongoDataTypeEntries } from './data-type-entries';
import { mongoTextDataTypes } from './data-types';
import { mongoNowGeneratorIds, mongoNowGenerators } from './date-time-now-generators';
import { mongoTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const mongoTargetDescriptorMetaBase = {
  ...mongoTargetDescriptorMetaRuntime,
  authoring: {
    type: mongoAuthoringTypes,
    dataTypes: mongoDataTypeEntries(),
    textDataTypes: mongoTextDataTypes,
  },
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [
      { id: TIMESTAMP_NOW_GENERATOR_ID },
      ...mongoNowGenerators.map(({ id }) => ({ id })),
    ],
  },
  generatorFunctions: [
    {
      name: 'now',
      signature: { documentation: 'Writes the current time.' },
      bindings: Object.entries(mongoNowGeneratorIds).map(([codecId, generatorId]) =>
        singleGeneratorBinding({ codecIds: [codecId], generatorId }),
      ),
    },
  ],
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams;
  readonly __dataTypeArguments?: {
    readonly 'mongo/int32': { readonly argument: number; readonly parameter: number };
  };
} = mongoTargetDescriptorMetaBase;
