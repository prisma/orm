import type { CodecTypes } from '../exports/codec-types';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringFieldPresets,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
  postgresLowerEntityHandles,
} from './authoring';
import { postgresRenderCheckExpressions } from './check-expressions';
import { postgresQualifyColumnType } from './codecs';
import { postgresTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { postgresIndexTypes } from './index-types';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';
import { postgresCreateNamespace } from './postgres-schema';

const postgresTargetDescriptorMetaBase = {
  ...postgresTargetDescriptorMetaRuntime,
  defaultNamespaceId: DEFAULT_NAMESPACE_ID,
  supportsNamespaces: true,
  indexTypes: postgresIndexTypes,
  authoring: {
    type: postgresAuthoringTypes,
    field: postgresAuthoringFieldPresets,
    entityTypes: postgresAuthoringEntityTypes,
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    modelAttributes: postgresAuthoringModelAttributes,
    createNamespace: postgresCreateNamespace,
    qualifyColumnType: postgresQualifyColumnType,
    renderCheckExpressions: postgresRenderCheckExpressions,
    lowerEntityHandles: postgresLowerEntityHandles,
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgresTargetDescriptorMetaBase;
