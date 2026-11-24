import type { CommandCompletion } from '@prisma/internals'

export const versionCompletion: CommandCompletion = {
  name: 'version',
  description: 'Displays Prisma version info',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'json', description: 'Output version information as JSON' },
  ],
}
