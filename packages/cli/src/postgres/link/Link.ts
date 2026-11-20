import { select } from '@inquirer/prompts'
import type { PrismaConfigInternal } from '@prisma/config'
import { arg, type Command, format, HelpError, isError } from '@prisma/internals'
import type { ManagementApiClient } from '@prisma/management-api-sdk'
import { AuthError, createManagementApiClient } from '@prisma/management-api-sdk'
import { bold, dim, green, red } from 'kleur/colors'

import { getModelNames } from '../../bootstrap/project-state'
import { login } from '../../management-api/auth'
import { createAuthenticatedManagementAPI } from '../../management-api/auth-client'
import { FileTokenStorage } from '../../management-api/token-storage'
import type { CliDistributionIdentity } from '../../utils/cli-distribution-identity'
import { formatCompletionOutput } from './completion-output'
import { isAlreadyLinked, writeLocalFiles, type WriteLocalFilesResult } from './local-setup'
import {
  createDevConnection,
  getDatabase,
  LinkApiError,
  listDatabases,
  listProjects,
  sanitizeErrorMessage,
} from './management-api'

export interface LinkResult {
  workspaceId: string
  projectId: string
  environmentId: string
  databaseId: string
  connectionString: string
  localFilesResult: WriteLocalFilesResult
  hasModels: boolean
}

interface DatabaseSelection {
  databaseId: string
  workspaceId: string
  projectId: string
}

const DEFAULT_MANAGEMENT_API_URL = 'https://api.prisma.io'

function getManagementApiUrl(): string {
  return process.env.PRISMA_MANAGEMENT_API_URL ?? DEFAULT_MANAGEMENT_API_URL
}

async function resolveApiClient(apiKey: string | undefined): Promise<ManagementApiClient> {
  if (apiKey) {
    return createManagementApiClient({ baseUrl: getManagementApiUrl(), token: apiKey })
  }

  const tokenStorage = new FileTokenStorage()
  const tokens = await tokenStorage.getTokens()

  if (!tokens) {
    console.log(`Opening browser to authenticate on ${dim('console.prisma.io')}...`)
    await login({ utmMedium: 'command-postgres-link' })
  }

  return createAuthenticatedManagementAPI().client
}

function isExpiredSessionError(err: unknown): boolean {
  return err instanceof AuthError && err.refreshTokenInvalid
}

async function resolveDatabase(client: ManagementApiClient): Promise<DatabaseSelection> {
  const projects = await listProjects(client)

  if (projects.length === 0) {
    throw new LinkApiError('No projects found in your workspace. Create one at console.prisma.io first.')
  }

  const projectId = await select({
    message: 'Select a project:',
    choices: projects.map((p) => ({
      name: `${p.name}  ${dim(p.workspace.name)}`,
      value: p.id,
    })),
    loop: true,
  })

  const selectedProject = projects.find((p) => p.id === projectId)
  const workspaceId = selectedProject?.workspace?.id ?? 'unknown'

  const databases = (await listDatabases(client, projectId)).filter((db) => db.status === 'ready')

  if (databases.length === 0) {
    throw new LinkApiError('No ready databases found in this project. Create one at console.prisma.io first.')
  }

  if (databases.length === 1) {
    const db = databases[0]
    console.log(`${green('✔')} Using database ${bold(db.name)}${db.region ? ` (${db.region.name})` : ''}`)
    return { databaseId: db.id, workspaceId, projectId }
  }

  const databaseId = await select({
    message: 'Select a database:',
    choices: databases.map((db) => ({
      name: `${db.name}  ${dim(db.region?.name ?? 'unknown region')}`,
      value: db.id,
    })),
    loop: true,
  })

  return { databaseId, workspaceId, projectId }
}

function extractWorkspaceIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2 || !parts[1]) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (typeof payload !== 'object' || payload === null) return null
    return payload.workspace_id ?? payload.workspaceId ?? null
  } catch {
    return null
  }
}

async function resolveProjectForDatabase(client: ManagementApiClient, databaseId: string): Promise<string | null> {
  try {
    const database = await getDatabase(client, databaseId)
    return database?.project?.id ?? null
  } catch {
    return null
  }
}

export class Link implements Command {
  public static new(identity: CliDistributionIdentity): Link {
    return new Link(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  public async parse(argv: string[], _config: PrismaConfigInternal, baseDir: string): Promise<string | Error> {
    const args = arg(argv, {
      '--api-key': String,
      '--database': String,
      '--force': Boolean,
      '--help': Boolean,
      '-h': '--help',
      '--telemetry-information': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    if (!args['--force'] && isAlreadyLinked(baseDir)) {
      return `\nThis project is already linked to Prisma Postgres.\nRun with ${bold('--force')} to re-link.\n`
    }

    const explicitApiKey = args['--api-key']
    const databaseId = args['--database']
    const apiKey = explicitApiKey ?? (databaseId ? process.env.PRISMA_API_KEY : undefined)

    if (explicitApiKey && !databaseId) {
      return new HelpError(
        `\n${bold(red('!'))} Missing ${bold('--database')} flag.\n\nWhen using ${bold('--api-key')}, you must also provide ${bold('--database')}.\n${createHelp(this.identity)}`,
      )
    }

    if (databaseId && !databaseId.startsWith('db_')) {
      return new HelpError(
        `\n${bold(red('!'))} Invalid database ID "${databaseId}" — expected format: ${bold('db_<id>')}\n${createHelp(this.identity)}`,
      )
    }

    try {
      const result = await this.executeLinkFlow(apiKey, databaseId, baseDir)
      return formatCompletionOutput(result, this.identity)
    } catch (err) {
      if (!apiKey && isExpiredSessionError(err)) {
        console.log(`Session expired. Re-authenticating via browser...`)
        await login({ utmMedium: 'command-postgres-link' })
        try {
          const result = await this.executeLinkFlow(apiKey, databaseId, baseDir)
          return formatCompletionOutput(result, this.identity)
        } catch (retryErr) {
          return Link.formatError(retryErr)
        }
      }
      return Link.formatError(err)
    }
  }

  async link(
    apiKey: string | undefined,
    databaseId: string | undefined,
    baseDir: string,
    opts?: { force?: boolean },
  ): Promise<LinkResult> {
    if (!opts?.force && isAlreadyLinked(baseDir)) {
      throw new LinkApiError('This project is already linked to Prisma Postgres. Use force to re-link.')
    }

    try {
      return await this.executeLinkFlow(apiKey, databaseId, baseDir)
    } catch (err) {
      if (!apiKey && isExpiredSessionError(err)) {
        console.log(`Session expired. Re-authenticating via browser...`)
        await login({ utmMedium: 'command-postgres-link' })
        return await this.executeLinkFlow(apiKey, databaseId, baseDir)
      }
      throw err
    }
  }

  private async executeLinkFlow(
    apiKey: string | undefined,
    databaseId: string | undefined,
    baseDir: string,
  ): Promise<LinkResult> {
    const client = await resolveApiClient(apiKey)

    let workspaceId: string | null = null
    let projectId: string | null = null

    if (!databaseId) {
      const resolved = await resolveDatabase(client)
      databaseId = resolved.databaseId
      workspaceId = resolved.workspaceId
      projectId = resolved.projectId
    } else {
      workspaceId = apiKey ? extractWorkspaceIdFromToken(apiKey) : null
      projectId = await resolveProjectForDatabase(client, databaseId)
    }

    const connection = await createDevConnection(client, databaseId)
    const localFilesResult = writeLocalFiles(baseDir, connection)
    const hasModels = getModelNames(baseDir).length > 0
    const environmentId = databaseId.replace(/^db_/, '')

    return {
      workspaceId: workspaceId ?? 'unknown',
      projectId: projectId ?? 'unknown',
      environmentId,
      databaseId,
      connectionString: connection.connectionString,
      localFilesResult,
      hasModels,
    }
  }

  private static formatError(err: unknown): HelpError {
    if (err instanceof LinkApiError) {
      return new HelpError(`\n${bold(red('!'))} ${sanitizeErrorMessage(err.message)}`)
    }
    const message = err instanceof Error ? err.message : String(err)
    return new HelpError(`\n${bold(red('!'))} ${sanitizeErrorMessage(message)}`)
  }

  public help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }
    return createHelp(this.identity)
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
Link a local project to a Prisma Postgres database.

${bold('Usage')}

  ${dim('$')} ${identity} postgres link [options]

${bold('Options')}

  --api-key      Workspace API key (CI / non-interactive)
  --database     Database ID to link to (e.g. db_abc123)
  --force        Re-link even if already linked to Prisma Postgres
  -h, --help     Display this help message

${bold('Examples')}

  Interactive (opens browser, lets you pick project & database)
  ${dim('$')} ${identity} postgres link

  Non-interactive with explicit credentials
  ${dim('$')} ${identity} postgres link --api-key "<your-api-key>" --database "db_..."
`)
}
