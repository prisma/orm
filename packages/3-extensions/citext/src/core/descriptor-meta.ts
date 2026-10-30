import type { CodecTypes } from '../types/codec-types';
import { citextAuthoringTypes } from './authoring';
import { citextDataTypes } from './data-types';
import { citextCodecRegistry } from './registry';

const citextPackMetaBase = {
  kind: 'extension',
  id: 'citext',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: citextAuthoringTypes,
  },
  dataTypes: citextDataTypes,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(citextCodecRegistry.values()),
      import: {
        package: '@internal/extension-citext/codec-types',
        named: 'CodecTypes',
        alias: 'CitextTypes',
      },
    },
  },
} as const;

export const citextPackMeta: typeof citextPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = citextPackMetaBase;
