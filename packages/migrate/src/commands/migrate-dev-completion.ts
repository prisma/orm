import type { CommandCompletion } from '@prisma/internals'
import {
  completionConfigPaths,
  completionDatasourceUrls,
  completionMigrationNames,
  completionSchemaPaths,
} from '@prisma/internals'

export const migrateDevCompletion: CommandCompletion = {
  name: 'migrate dev',
  description: 'Create and apply migrations in development',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    {
      name: 'url',
      description: 'Override the datasource URL from the Prisma config file',
      values: completionDatasourceUrls,
    },
    { name: 'name', alias: 'n', description: 'Name the migration', values: completionMigrationNames },
    { name: 'create-only', description: 'Create a new migration but do not apply it' },
  ],
}
