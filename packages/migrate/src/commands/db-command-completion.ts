import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionSchemaPaths } from '@prisma/internals'

export const dbCompletion: CommandCompletion = {
  name: 'db',
  description: 'Manage your database schema and lifecycle',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
  ],
}
