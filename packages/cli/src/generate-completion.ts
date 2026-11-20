import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionGeneratorNames, completionSchemaPaths } from '@prisma/internals'

export const generateCompletion: CommandCompletion = {
  name: 'generate',
  description: 'Generate artifacts (e.g. Prisma Client)',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'schema', description: 'Custom path to your Prisma schema', values: completionSchemaPaths },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'watch', description: 'Watch the Prisma schema and rerun after a change' },
    {
      name: 'generator',
      description: 'Generator to use (may be provided multiple times)',
      values: completionGeneratorNames,
    },
    { name: 'no-hints', description: 'Hides the hint messages but still outputs errors and warnings' },
    { name: 'require-models', description: 'Do not allow generating a client without models' },
    { name: 'sql', description: 'Generate TypedSQL module' },
  ],
}
