import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionSchemaPaths } from '@prisma/internals'

export const dbSeedCompletion: CommandCompletion = {
  name: 'db seed',
  description: 'Seed your database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
  ],
}
