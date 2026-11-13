import type { CodecTypes } from '../exports/codec-types';
import { mysqlDataTypes } from './data-types';

const mysqlTargetDescriptorMetaRuntimeBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'mysql',
  id: 'mysql',
  version: '0.0.1',
  capabilities: {},
  dataTypes: mysqlDataTypes,
  sessionSettings: { time_zone: '+00:00' },
} as const;

export const mysqlTargetDescriptorMetaRuntime: typeof mysqlTargetDescriptorMetaRuntimeBase & {
  readonly __codecTypes?: CodecTypes;
} = mysqlTargetDescriptorMetaRuntimeBase;
