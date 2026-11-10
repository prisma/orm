import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecTypes } from '../exports/codec-types';
import { sqliteAuthoringTypes } from './authoring';
import { sqliteDataTypeEntries } from './data-type-entries';
import { sqliteTextDataTypes } from './data-types';
import { sqliteTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { sqliteGeneratorDescriptors, sqliteGeneratorFunctions } from './generator-functions';
import { sqliteScalarTypeConstructors } from './type-constructors';

const sqliteTargetDescriptorMetaBase = {
  ...sqliteTargetDescriptorMetaRuntime,
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  supportsNamespaces: false,
  displayName: 'SQLite',
  authoring: {
    type: { ...sqliteScalarTypeConstructors, ...sqliteAuthoringTypes },
    dataTypes: sqliteDataTypeEntries(),
    textDataTypes: sqliteTextDataTypes,
  },
  generatorFunctions: sqliteGeneratorFunctions,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: sqliteGeneratorDescriptors,
  },
} as const;

export const sqliteTargetDescriptorMeta: typeof sqliteTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __dataTypeArguments?: {
    readonly 'sqlite/real': { readonly argument: number; readonly parameter: number };
  };
} = sqliteTargetDescriptorMetaBase;
