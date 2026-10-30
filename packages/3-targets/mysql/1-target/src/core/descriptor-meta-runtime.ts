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

/** The runtime-safe part of the MySQL target's metadata: it leaves out `authoring`, which only contract construction reads. Every session runs in UTC, because the datetime codec reads and writes UTC. */
export const mysqlTargetDescriptorMetaRuntime: typeof mysqlTargetDescriptorMetaRuntimeBase & {
  readonly __codecTypes?: CodecTypes;
} = mysqlTargetDescriptorMetaRuntimeBase;
