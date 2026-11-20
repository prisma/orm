import type { CommandCompletion } from '@prisma/internals'
import { completionApiKeyHint, completionDatabaseIdHint } from '@prisma/internals'

import { CURATED_TEMPLATES } from './template-definitions'

export const bootstrapCompletion: CommandCompletion = {
  name: 'bootstrap',
  description: 'Bootstrap a Prisma Postgres project',
  options: [
    { name: 'api-key', description: 'Workspace API key (CI / non-interactive)', values: completionApiKeyHint },
    { name: 'database', description: 'Database ID to link to (e.g. db_abc123)', values: completionDatabaseIdHint },
    {
      name: 'template',
      description: 'Starter template name',
      values: CURATED_TEMPLATES.map(({ name, label }) => ({ value: name, description: `${label} starter` })),
    },
    { name: 'force', description: 'Re-link even if already linked to Prisma Postgres' },
  ],
}
