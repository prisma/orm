import { DRIVER_INFO } from './driver-info';

export const mongoDriverDescriptorMeta = {
  kind: 'driver',
  familyId: 'mongo',
  targetId: 'mongo',
  id: 'mongo',
  version: DRIVER_INFO.version,
  capabilities: {},
} as const;
