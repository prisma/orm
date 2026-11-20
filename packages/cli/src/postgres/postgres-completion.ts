import type { CommandCompletion } from '@prisma/internals'

export const postgresCompletion: CommandCompletion = {
  name: 'postgres',
  description: 'Manage Prisma Postgres databases',
  options: [{ name: 'help', alias: 'h', description: 'Display this help message' }],
}
