import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionMigrationIds, completionSchemaPaths } from '@prisma/internals'

export const migrateResolveCompletion: CommandCompletion = {
  name: 'migrate resolve',
  description: 'Mark a migration as applied or rolled back',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'applied', description: 'Mark a migration as applied', values: completionMigrationIds },
    { name: 'rolled-back', description: 'Mark a migration as rolled back', values: completionMigrationIds },
  ],
}
