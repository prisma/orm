import type { CommandCompletion } from '@prisma/internals'
import { completionConfigPaths, completionSqlScriptPaths } from '@prisma/internals'

export const dbExecuteCompletion: CommandCompletion = {
  name: 'db execute',
  description: 'Execute SQL or scripts on your database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'config', description: 'Custom path to your Prisma config file', values: completionConfigPaths },
    { name: 'file', description: 'Path to a file containing the script to execute', values: completionSqlScriptPaths },
    { name: 'stdin', description: 'Use terminal standard input as the script to execute' },
  ],
}
