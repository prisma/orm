/** What the connection this driver opens provides. No PostgreSQL flag is of that kind yet. */
export const postgresDriverCapabilities = Object.freeze({} as const);

export const postgresDriverDescriptorMeta = {
  kind: 'driver',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: postgresDriverCapabilities,
} as const;
