import type { CommandCompletion, CompletionOption } from '@prisma/internals'
import {
  completionDevDbPorts,
  completionDevHttpPorts,
  completionDevServerNames,
  completionDevShadowDbPorts,
} from '@prisma/internals'
import {
  dbCompletion,
  dbExecuteCompletion,
  dbPullCompletion,
  dbPushCompletion,
  dbSeedCompletion,
  migrateCompletion,
  migrateDeployCompletion,
  migrateDevCompletion,
  migrateDiffCompletion,
  migrateResetCompletion,
  migrateResolveCompletion,
  migrateStatusCompletion,
} from '@prisma/migrate'

import { bootstrapCompletion } from '../bootstrap/bootstrap-completion'
import { debugInfoCompletion } from '../debug-info-completion'
import { formatCompletion } from '../format-completion'
import { generateCompletion } from '../generate-completion'
import { initCompletion } from '../init-completion'
import { mcpCompletion } from '../mcp/mcp-completion'
import { platformCompletion } from '../platform/platform-completion'
import { postgresLinkCompletion } from '../postgres/link/link-completion'
import { postgresCompletion } from '../postgres/postgres-completion'
import { studioCompletion } from '../studio-completion'
import { validateCompletion } from '../validate-completion'
import { versionCompletion } from '../version-completion'

const devCompletion: CommandCompletion = {
  name: 'dev',
  description: 'Start a local Prisma Postgres server for development',
  options: [
    {
      name: 'name',
      alias: 'n',
      description: 'Name of the server (helps keep state isolated between different projects)',
      values: completionDevServerNames,
    },
    {
      name: 'port',
      alias: 'p',
      description: 'Main port number for the HTTP server',
      values: completionDevHttpPorts,
    },
    {
      name: 'db-port',
      alias: 'P',
      description: 'Port number for the database server',
      values: completionDevDbPorts,
    },
    {
      name: 'shadow-db-port',
      description: 'Port number for the shadow database server',
      values: completionDevShadowDbPorts,
    },
    { name: 'detach', alias: 'd', description: 'Run the server in the background' },
    { name: 'debug', description: 'Enable debug logging' },
  ],
}

const devDebugOption: CompletionOption = { name: 'debug', description: 'Enable debug logging' }

const devLsCompletion: CommandCompletion = {
  name: 'dev ls',
  description: 'List available servers',
  options: [devDebugOption],
}

const devRmCompletion: CommandCompletion = {
  name: 'dev rm',
  description: 'Remove servers',
  options: [devDebugOption, { name: 'force', description: 'Stop any running servers before removing them' }],
}

const devStartCompletion: CommandCompletion = {
  name: 'dev start',
  description: 'Start one or more stopped servers',
  options: [devDebugOption],
}

const devStopCompletion: CommandCompletion = {
  name: 'dev stop',
  description: 'Stop servers',
  options: [devDebugOption],
}

export const SUPPORTED_SHELLS = ['zsh', 'bash', 'fish', 'powershell'] as const

const completeCompletion: CommandCompletion = {
  name: 'complete',
  description: 'Generate shell completion script',
  subcommands: SUPPORTED_SHELLS.map((shell) => ({
    name: `complete ${shell}`,
    description: `Generate completion script for ${shell}`,
  })),
}

export const ALL_COMPLETIONS: CommandCompletion[] = [
  initCompletion,
  bootstrapCompletion,
  devCompletion,
  devLsCompletion,
  devRmCompletion,
  devStartCompletion,
  devStopCompletion,
  generateCompletion,
  studioCompletion,
  validateCompletion,
  formatCompletion,
  versionCompletion,
  debugInfoCompletion,
  mcpCompletion,
  platformCompletion,
  postgresCompletion,
  postgresLinkCompletion,
  completeCompletion,
  dbCompletion,
  dbExecuteCompletion,
  dbPullCompletion,
  dbPushCompletion,
  dbSeedCompletion,
  migrateCompletion,
  migrateDevCompletion,
  migrateResetCompletion,
  migrateDeployCompletion,
  migrateStatusCompletion,
  migrateResolveCompletion,
  migrateDiffCompletion,
]
