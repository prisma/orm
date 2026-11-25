import { postgresDriverCapabilities } from './capabilities';

export const postgresDriverDescriptorMeta = {
  kind: 'driver',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: postgresDriverCapabilities,
} as const;
