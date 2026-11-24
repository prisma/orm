import type { CommandCompletion } from '@prisma/internals'
import {
  completionConfigPaths,
  completionDatasourceUrls,
  completionStudioBrowsers,
  completionStudioPorts,
} from '@prisma/internals'

export const studioCompletion: CommandCompletion = {
  name: 'studio',
  description: 'Browse your data with Prisma Studio',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    {
      name: 'url',
      description: 'Database connection string (overrides the one in your Prisma config file)',
      values: completionDatasourceUrls,
    },
    { name: 'port', alias: 'p', description: 'Port to start Studio on', values: completionStudioPorts },
    { name: 'browser', alias: 'b', description: 'Browser to auto-open Studio in', values: completionStudioBrowsers },
  ],
}
