import type { CommandCompletion } from '@prisma/internals'
import {
  completionConfigPaths,
  completionDiffOutputPaths,
  completionMigrationsDirPaths,
  completionSchemaPaths,
} from '@prisma/internals'

export const migrateDiffCompletion: CommandCompletion = {
  name: 'migrate diff',
  description: 'Compare the database schema from two arbitrary sources',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    {
      name: 'output',
      alias: 'o',
      description: 'Write the diff to a file instead of stdout',
      values: completionDiffOutputPaths,
    },
    { name: 'from-empty', description: 'Assume the source data model is empty' },
    { name: 'from-schema', description: 'Path to a Prisma schema file as the source', values: completionSchemaPaths },
    {
      name: 'from-migrations',
      description: 'Path to a Prisma migrations directory as the source',
      values: completionMigrationsDirPaths,
    },
    { name: 'from-config-datasource', description: 'Use the datasource from the Prisma config file as the source' },
    { name: 'to-empty', description: 'Assume the destination data model is empty' },
    {
      name: 'to-schema',
      description: 'Path to a Prisma schema file as the destination',
      values: completionSchemaPaths,
    },
    {
      name: 'to-migrations',
      description: 'Path to a Prisma migrations directory as the destination',
      values: completionMigrationsDirPaths,
    },
    {
      name: 'to-config-datasource',
      description: 'Use the datasource from the Prisma config file as the destination',
    },
    { name: 'script', description: 'Output a SQL script instead of a human-readable summary' },
    { name: 'exit-code', description: 'Change the exit code behavior (Empty=0, Error=1, Not empty=2)' },
  ],
}
