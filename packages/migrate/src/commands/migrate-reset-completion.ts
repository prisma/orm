import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionSchemaPaths } from '@prisma/internals'

export const migrateResetCompletion: CommandCompletion = {
  name: 'migrate reset',
  description: 'Reset your database and apply all migrations',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'force', alias: 'f', description: 'Skip the confirmation prompt' },
  ],
}
