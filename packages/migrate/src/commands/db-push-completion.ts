import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionDatasourceUrls, completionSchemaPaths } from '@prisma/internals'

export const dbPushCompletion: CommandCompletion = {
  name: 'db push',
  description: 'Push the Prisma schema state to the database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    {
      name: 'url',
      description: 'Override the datasource URL from the Prisma config file',
      values: completionDatasourceUrls,
    },
    { name: 'accept-data-loss', description: 'Ignore data loss warnings' },
    { name: 'force-reset', description: 'Force a reset of the database before push' },
  ],
}
