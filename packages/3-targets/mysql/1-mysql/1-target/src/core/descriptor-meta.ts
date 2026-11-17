import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecTypes } from '../exports/codec-types';
import { mysqlAuthoringTypes } from './authoring';
import { mysqlDataTypeEntries } from './data-type-entries';
import { mysqlTextDataTypes } from './data-types';
import { mysqlTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { mysqlGeneratorDescriptors, mysqlGeneratorFunctions } from './generator-functions';
import { mysqlScalarTypeConstructors } from './type-constructors';

const mysqlTargetDescriptorMetaBase = {
  ...mysqlTargetDescriptorMetaRuntime,
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  supportsNamespaces: false,
  displayName: 'MySQL',
  authoring: {
    type: { ...mysqlScalarTypeConstructors, ...mysqlAuthoringTypes },
    dataTypes: mysqlDataTypeEntries(),
    textDataTypes: mysqlTextDataTypes,
  },
  generatorFunctions: mysqlGeneratorFunctions,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: mysqlGeneratorDescriptors,
  },
} as const;

export const mysqlTargetDescriptorMeta: typeof mysqlTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __dataTypeArguments?: {
    readonly 'mysql/int': { readonly argument: number; readonly parameter: number };
  };
} = mysqlTargetDescriptorMetaBase;
