import type { CommandCompletion } from '@prisma/internals'
import {
  completionClientOutputPaths,
  completionDatasourceProviders,
  completionDatasourceUrls,
  completionGeneratorProviders,
  completionPreviewFeatures,
} from '@prisma/internals'

export const initCompletion: CommandCompletion = {
  name: 'init',
  description: 'Set up Prisma for your app',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'url', description: 'Define a custom datasource url', values: completionDatasourceUrls },
    {
      name: 'datasource-provider',
      description: 'Define the datasource provider',
      values: completionDatasourceProviders,
    },
    {
      name: 'generator-provider',
      description: 'Define the generator provider',
      values: completionGeneratorProviders,
    },
    {
      name: 'preview-feature',
      description: 'Define a preview feature to use (can be specified multiple times)',
      values: completionPreviewFeatures,
    },
    { name: 'output', description: 'Define Prisma Client generator output path', values: completionClientOutputPaths },
    { name: 'with-model', description: 'Add an example model to the created schema file' },
    { name: 'db', description: 'Provision a fully managed Prisma Postgres database on the Prisma Data Platform' },
  ],
}
