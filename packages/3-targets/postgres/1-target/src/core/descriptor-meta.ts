import type { CodecTypes, ParameterizedOutputTypesForTypeParams } from '../exports/codec-types';
import type { QueryOperationTypesForCodecs } from '../types/operation-types';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
  postgresLowerEntityHandles,
} from './authoring';
import { postgresRenderCheckExpressions } from './check-expressions';
import { postgresQualifyColumnType } from './codecs';
import { postgresDataTypeEntries } from './data-type-entries';
import { postgresTextDataTypes } from './data-types';
import { postgresTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { postgresGeneratorDescriptors, postgresGeneratorFunctions } from './generator-functions';
import { postgresIndexTypes } from './index-types';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';
import { postgresCreateNamespace } from './postgres-schema';
import { prisma7PostgresRenamedNativeTypes } from './prisma7-type-map';
import { postgresScalarAndNativeTypeConstructors } from './type-constructors';

const postgresTargetDescriptorMetaBase = {
  ...postgresTargetDescriptorMetaRuntime,
  defaultNamespaceId: DEFAULT_NAMESPACE_ID,
  supportsNamespaces: true,
  displayName: 'Postgres',
  indexTypes: postgresIndexTypes,
  authoring: {
    type: { ...postgresScalarAndNativeTypeConstructors, ...postgresAuthoringTypes },
    dataTypes: postgresDataTypeEntries(),
    textDataTypes: postgresTextDataTypes,
    renamedTypeConstructors: prisma7PostgresRenamedNativeTypes,
    entityTypes: postgresAuthoringEntityTypes,
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    modelAttributes: postgresAuthoringModelAttributes,
    createNamespace: postgresCreateNamespace,
    qualifyColumnType: postgresQualifyColumnType,
    renderCheckExpressions: postgresRenderCheckExpressions,
    lowerEntityHandles: postgresLowerEntityHandles,
  },
  generatorFunctions: postgresGeneratorFunctions,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: postgresGeneratorDescriptors,
  },
  types: {
    queryOperationTypes: {
      import: {
        package: '@internal/target-postgres/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgTargetQueryOps',
      },
    },
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __queryOperationTypes?: QueryOperationTypesForCodecs;
  readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams;
  readonly __dataTypeArguments?: {
    readonly 'pg/int4': { readonly argument: number; readonly parameter: number };
  };
} = postgresTargetDescriptorMetaBase;
