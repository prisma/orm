import type { CommandCompletion } from '@prisma/internals'

export const platformCompletion: CommandCompletion = {
  name: 'platform',
  description: 'Prisma Data Platform commands',
  options: [{ name: 'help', alias: 'h', description: 'Display this help message' }],
  subcommands: [
    {
      name: 'platform status',
      description: 'Show Prisma Data Platform service status',
      options: [{ name: 'help', alias: 'h', description: 'Display this help message' }],
    },
  ],
}
