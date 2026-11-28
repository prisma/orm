import { type } from 'arktype';

export const PostgresRoleSchema = type({
  '+': 'reject',
  kind: "'role'",
  name: 'string',
  namespaceId: 'string',
  'control?': "'external'",
});

export const PostgresRlsPolicySchema = type({
  '+': 'reject',
  kind: "'policy'",
  name: 'string',
  'prefix?': 'string',
  tableName: 'string',
  namespaceId: 'string',
  operation: "'select' | 'insert' | 'update' | 'delete' | 'all'",
  roles: type.string.array().readonly(),
  'using?': 'string',
  'withCheck?': 'string',
  permissive: 'boolean',
});

export const PostgresRlsEnablementSchema = type({
  '+': 'reject',
  kind: "'rls'",
  tableName: 'string',
  namespaceId: 'string',
});

export const PostgresNativeEnumSchema = type({
  '+': 'reject',
  kind: "'postgres-enum'",
  typeName: 'string',
  members: type.string.array().readonly(),
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});

export const PostgresExtensionSchema = type({
  '+': 'reject',
  kind: "'extension'",
  name: 'string',
  'control?': "'managed' | 'tolerated' | 'external' | 'observed'",
});
