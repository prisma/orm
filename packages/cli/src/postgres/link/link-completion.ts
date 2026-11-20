import type { CommandCompletion } from '@prisma/internals'
import { completionApiKeyHint, completionDatabaseIdHint } from '@prisma/internals'

export const postgresLinkCompletion: CommandCompletion = {
  name: 'postgres link',
  description: 'Link a local project to a Prisma Postgres database',
  options: [
    { name: 'help', alias: 'h', description: 'Display this help message' },
    { name: 'api-key', description: 'Workspace API key (CI / non-interactive)', values: completionApiKeyHint },
    { name: 'database', description: 'Database ID to link to (e.g. db_abc123)', values: completionDatabaseIdHint },
    { name: 'force', description: 'Re-link even if already linked to Prisma Postgres' },
  ],
}
