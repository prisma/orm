import { TIMESTAMP_NOW_GENERATOR_ID } from '@internal/framework-components/authoring';
import {
  singleGeneratorBinding,
  type TargetPackRef,
} from '@internal/framework-components/components';
import type { CodecTypes, ParameterizedOutputTypesForTypeParams } from '../exports/codec-types';
import { mongoAuthoringTypes } from './authoring';
import { MONGO_DATE_CODEC_ID } from './codec-ids';
import { mongoDataTypeEntries } from './data-type-entries';
import { mongoTextDataTypes } from './data-types';
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
    generatorDescriptors: [{ id: TIMESTAMP_NOW_GENERATOR_ID }],
  },
  generatorFunctions: [
    {
      name: 'now',
      signature: { documentation: 'Writes the current time.' },
      bindings: [
        singleGeneratorBinding({
          codecIds: [MONGO_DATE_CODEC_ID],
          generatorId: TIMESTAMP_NOW_GENERATOR_ID,
        }),
      ],
    },
  ],
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

export const mongoTargetDescriptorMeta: typeof mongoTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams;
} = mongoTargetDescriptorMetaBase;
