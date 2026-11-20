import type { CompletionValue } from './types'

export const completionSchemaPaths: CompletionValue[] = [
  { value: 'prisma/schema.prisma', description: 'Default schema path' },
  { value: './schema.prisma', description: 'Schema in project root' },
]

export const completionConfigPaths: CompletionValue[] = [
  { value: 'prisma7.config.ts', description: 'Default config path' },
]

export const completionDatasourceUrls: CompletionValue[] = [
  { value: 'postgresql://', description: 'PostgreSQL connection string' },
  { value: 'mysql://', description: 'MySQL connection string' },
  { value: 'file:', description: 'SQLite connection string' },
  { value: 'mongodb://', description: 'MongoDB connection string' },
  { value: 'sqlserver://', description: 'SQL Server connection string' },
]

export const completionApiKeyHint: CompletionValue[] = [{ value: '<your-api-key>', description: 'Workspace API key' }]

export const completionDatabaseIdHint: CompletionValue[] = [
  { value: 'db_', description: 'Database ID prefix (e.g. db_abc123)' },
]

export const completionGeneratorNames: CompletionValue[] = [
  { value: 'prisma-client', description: 'Prisma Client generator' },
  { value: 'prisma-client-js', description: 'Legacy Prisma Client JS generator' },
]

export const completionClientOutputPaths: CompletionValue[] = [
  { value: './generated/prisma', description: 'Common client output path' },
  { value: '../generated/prisma', description: 'Alternative client output path' },
]

export const completionPreviewFeatures: CompletionValue[] = [
  { value: 'typedSql', description: 'TypedSQL preview feature' },
]

export const completionSqlScriptPaths: CompletionValue[] = [{ value: './script.sql', description: 'SQL script file' }]

export const completionMigrationsDirPaths: CompletionValue[] = [
  { value: 'prisma/migrations', description: 'Default migrations directory' },
  { value: './migrations', description: 'Custom migrations directory' },
]

export const completionDiffOutputPaths: CompletionValue[] = [{ value: 'diff.sql', description: 'SQL diff output file' }]

export const completionMigrationNames: CompletionValue[] = [
  { value: 'init', description: 'Initial migration name' },
  { value: 'add_users', description: 'Example migration name' },
]

export const completionMigrationIds: CompletionValue[] = [
  { value: '20201231000000_add_users_table', description: 'Example migration ID' },
]

export const completionCompositeTypeDepths: CompletionValue[] = [
  { value: '-1', description: 'Infinite depth (default)' },
  { value: '0', description: 'Off' },
  { value: '2', description: 'Two levels deep' },
]

export const completionDatabaseSchemas: CompletionValue[] = [
  { value: 'public', description: 'PostgreSQL default schema' },
]

export const completionDatasourceProviders: CompletionValue[] = [
  { value: 'postgresql', description: 'PostgreSQL' },
  { value: 'mysql', description: 'MySQL' },
  { value: 'sqlite', description: 'SQLite' },
  { value: 'mongodb', description: 'MongoDB' },
  { value: 'sqlserver', description: 'SQL Server' },
  { value: 'cockroachdb', description: 'CockroachDB' },
]

export const completionGeneratorProviders: CompletionValue[] = [
  { value: 'prisma-client', description: 'Prisma Client' },
  { value: 'prisma-client-js', description: 'Legacy Prisma Client JS' },
]

export const completionStudioPorts: CompletionValue[] = [
  { value: '51212', description: 'Default Studio port' },
  { value: '5555', description: 'Common custom port' },
  { value: '3000', description: 'Alternative port' },
]

export const completionStudioBrowsers: CompletionValue[] = [
  { value: 'none', description: 'Do not open browser' },
  { value: 'chrome', description: 'Google Chrome' },
  { value: 'firefox', description: 'Mozilla Firefox' },
  { value: 'safari', description: 'Safari' },
]

export const completionDevServerNames: CompletionValue[] = [{ value: 'default', description: 'Default server name' }]

export const completionDevHttpPorts: CompletionValue[] = [{ value: '51213', description: 'Default HTTP server port' }]

export const completionDevDbPorts: CompletionValue[] = [{ value: '51214', description: 'Default database port' }]

export const completionDevShadowDbPorts: CompletionValue[] = [
  { value: '51215', description: 'Default shadow database port' },
]
