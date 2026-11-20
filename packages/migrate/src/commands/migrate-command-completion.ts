import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionSchemaPaths } from '@prisma/internals'

export const migrateCompletion: CommandCompletion = {
  name: 'migrate',
  description: 'Migrate your database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
  ],
}
