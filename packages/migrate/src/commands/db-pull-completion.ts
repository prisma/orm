import type { CommandCompletion } from '@prisma/internals'
import {
  completionCompositeTypeDepths,
  completionConfigPaths,
  completionDatabaseSchemas,
  completionDatasourceUrls,
  completionSchemaPaths,
} from '@prisma/internals'

export const dbPullCompletion: CommandCompletion = {
  name: 'db pull',
  description: 'Pull the schema from an existing database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    {
      name: 'url',
      description: 'Override the datasource URL from the Prisma config file',
      values: completionDatasourceUrls,
    },
    { name: 'force', description: 'Ignore current Prisma schema file' },
    { name: 'print', description: 'Print the introspected Prisma schema to stdout' },
    {
      name: 'composite-type-depth',
      description: 'Specify the depth for introspecting composite types',
      values: completionCompositeTypeDepths,
    },
    {
      name: 'schemas',
      description: 'Specify database schemas to introspect (overrides datasource block)',
      values: completionDatabaseSchemas,
    },
  ],
}
