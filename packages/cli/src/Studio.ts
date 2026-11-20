import { access, constants, readFile } from 'node:fs/promises'

import type { PrismaConfigInternal } from '@prisma/config'
import { arg, type Command, format, HelpError, isError } from '@prisma/internals'
import type { Executor, SequenceExecutor } from '@prisma/studio-core/data'
import { type SerializedError, serializeError, type StudioBFFRequest } from '@prisma/studio-core/data/bff'
import { createMySQL2Executor } from '@prisma/studio-core/data/mysql2'
import { createNodeSQLiteExecutor } from '@prisma/studio-core/data/node-sqlite'
import { createPostgresJSExecutor } from '@prisma/studio-core/data/postgresjs'
import type { StudioProps } from '@prisma/studio-core/ui'
import { type Check, check as sendEvent } from 'checkpoint-client'
import { getPort } from 'get-port-please'
import { bold, dim, red, yellow } from 'kleur/colors'
import { digest } from 'ohash'
import open from 'open'
import { dirname, extname, join, resolve } from 'pathe'
import { runtime } from 'std-env'

import packageJson from '../package.json' assert { type: 'json' }
import { STUDIO_CSS_FILE_NAME, STUDIO_JS_FILE_NAME, type StudioAdapterType } from './studio-frontend-shared'
import { startStudioServer, STUDIO_SERVER_HOST } from './studio-server'
import type { CliDistributionIdentity } from './utils/cli-distribution-identity'
import { UserFacingError } from './utils/errors'
import { getPpgInfo } from './utils/ppgInfo'

/**
 * `prisma dev`'s `51_213 - 1`
 */
const DEFAULT_PORT = 51_212

const MIN_PORT = 49_152

const FILE_EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.html': 'text/html',
}

const PRISMA_LOGO_SVG = `<svg width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M0.396923 8.8719C0.25789 9.09869 0.260041 9.38484 0.402469 9.60951L2.98037 13.6761C3.14768 13.94 3.47018 14.0603 3.76949 13.9705L11.2087 11.7388C11.6147 11.617 11.8189 11.1641 11.6415 10.7792L6.8592 0.405309C6.62598 -0.100601 5.92291 -0.142128 5.63176 0.332808L0.396923 8.8719ZM6.73214 2.77688C6.6305 2.54169 6.2863 2.57792 6.23585 2.82912L4.3947 11.9965C4.35588 12.1898 4.53686 12.3549 4.72578 12.2985L9.86568 10.7642C10.0157 10.7194 10.093 10.5537 10.0309 10.41L6.73214 2.77688Z"
    fill="currentColor"
  />
</svg>`
const PRISMA_LOGO_SVG_DATA_URL = `data:image/svg+xml,${encodeURIComponent(PRISMA_LOGO_SVG)}`

const ACCELERATE_UNSUPPORTED_MESSAGE =
  'Prisma Studio no longer supports Accelerate URLs (`prisma://` or `prisma+postgres://`). Use a direct database connection string instead.'

/**
 * Protocols whose connection strings are not valid WHATWG URLs.
 * URL.canParse would reject them, so we skip that validation.
 *
 * https://github.com/prisma/prisma/issues/29620
 */
const PROTOCOLS_SKIPPING_URL_VALIDATION = new Set(['sqlserver'])

interface StudioStuff {
  adapter: StudioAdapterType
  createExecutor(connectionString: string, relativeTo: string): Promise<Executor>
}

/**
 * A list of query parameters that are specific to Prisma ORM and should be removed
 * from the connection string before passing it to the Postgres client to avoid errors.
 *
 * @See https://www.prisma.io/docs/orm/overview/databases/postgresql#arguments
 * @See https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS
 */
const PRISMA_ORM_SPECIFIC_QUERY_PARAMETERS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'sslidentity',
  'sslaccept',
  'pool', // Using connection pooling with `postgres` package is unable to connect to PPG. Disabling it for now by removing the param. See https://linear.app/prisma-company/issue/TML-1670.
  'socket_timeout',
  'pgbouncer',
  'statement_cache_size',
] as const

const PRISMA_ORM_SPECIFIC_MYSQL_QUERY_PARAMETERS = [
  'connection_limit',
  'pool_timeout',
  'socket_timeout',
  'sslaccept',
  'sslidentity',
] as const

const POSTGRES_STUDIO_STUFF: StudioStuff = {
  adapter: 'postgres',
  async createExecutor(connectionString) {
    const postgresModule = await import('postgres')

    const connectionURL = new URL(connectionString)

    for (const queryParameter of PRISMA_ORM_SPECIFIC_QUERY_PARAMETERS) {
      connectionURL.searchParams.delete(queryParameter)
    }

    const postgres = postgresModule.default(connectionURL.toString())

    process.once('SIGINT', () => postgres.end())
    process.once('SIGTERM', () => postgres.end())

    return createPostgresJSExecutor(postgres)
  },
}

type Database = { new (path: string): import('better-sqlite3').Database }

const CONNECTION_STRING_PROTOCOL_TO_STUDIO_STUFF: Record<string, StudioStuff | null> = {
  // TODO: figure out PGLite support later.
  file: {
    adapter: 'sqlite',
    async createExecutor(uri, relativeTo) {
      const path = uri.replace('file:', '')

      const isInMemory = path === ':memory:'

      const resolvedPath = isInMemory ? path : resolve(relativeTo, path)

      if (!isInMemory) {
        await access(resolvedPath, constants.F_OK).catch(() => {
          console.warn(
            yellow(
              `Database file at "${resolvedPath}" was not found. A new file was created. If this is an unwanted side effect, it might mean that the URL you have provided is incorrect.`,
            ),
          )
        })
      }

      let database: InstanceType<Database> | undefined = undefined

      try {
        // TODO: remove 'as' once Node.js v22 is the minimum supported version.
        const { DatabaseSync } = (await import('node:sqlite' as never)) as {
          DatabaseSync: Database
        }

        database = new DatabaseSync(resolvedPath)
      } catch (error: unknown) {
        try {
          switch (runtime) {
            case 'node': {
              const { default: Database } = await import('better-sqlite3')

              database = new Database(resolvedPath)
              break
            }
            case 'deno': {
              const { Database } = (await import('jsr:@db/sqlite@0.13.0' as never)) as {
                Database: Database
              }

              database = new Database(resolvedPath)
              break
            }
            case 'bun': {
              const { Database } = (await import('bun:sqlite' as never)) as {
                Database: Database
              }

              database = new Database(resolvedPath) as never
              break
            }
            default:
              throw new Error(`Unsupported runtime for SQLite: "${runtime}"`)
          }
        } catch (error: unknown) {
          throw new Error(
            `Failed to open SQLite database at "${resolvedPath}".\nCaused by: ${(error as Error).message}

Please use Node.js >=22.5, Deno >=2.2 or Bun >=1.0 or ensure you have the \`better-sqlite3\` package installed for Node.js <22.5 or the \`jsr:@db/sqlite\` package installed for Deno <2.2.`,
          )
        }
      }

      process.once('SIGINT', () => database!.close())
      process.once('SIGTERM', () => database!.close())

      return createNodeSQLiteExecutor(database)
    },
  },
  postgres: POSTGRES_STUDIO_STUFF,
  postgresql: POSTGRES_STUDIO_STUFF,
  mysql: {
    adapter: 'mysql',
    async createExecutor(connectionString) {
      const { createPool } = await import('mysql2/promise')

      const pool = createPool(normalizeMySQLConnectionString(connectionString))

      process.once('SIGINT', () => pool.end())
      process.once('SIGTERM', () => pool.end())

      return createMySQL2Executor(pool)
    },
  },
  sqlserver: null,
}

export class Studio implements Command {
  static new(identity: CliDistributionIdentity): Studio {
    return new Studio(identity)
  }

  constructor(private readonly identity: CliDistributionIdentity) {}

  help(error?: string): string | HelpError {
    if (error) {
      return new HelpError(`\n${bold(red(`!`))} ${error}\n${createHelp(this.identity)}`)
    }

    return createHelp(this.identity)
  }

  /**
   * Parses arguments passed to this command, and starts Studio
   *
   * @param argv Array of all arguments
   * @param config The loaded Prisma config
   */
  async parse(argv: string[], config: PrismaConfigInternal): Promise<string | Error> {
    const args = arg(argv, {
      '--help': Boolean,
      '-h': '--help',
      '--config': String,
      '--port': Number,
      '-p': '--port',
      '--browser': String,
      '-b': '--browser',
      '--url': String,
    })

    if (isError(args)) {
      return this.help(args.message)
    }

    if (args['--help']) {
      return this.help()
    }

    const requestedPort = args['--port']

    if (
      requestedPort !== undefined &&
      (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65_535)
    ) {
      return new UserFacingError('The Studio port must be an integer between 1 and 65535.')
    }

    const connectionString = args['--url'] || config.datasource?.url

    if (!connectionString) {
      return new UserFacingError(
        'No database URL found. Provide it via the `--url <url>` argument or define it in your Prisma config file as `datasource.url`.',
      )
    }

    const protocol = connectionString.split('://')[0].toLowerCase()

    if (!PROTOCOLS_SKIPPING_URL_VALIDATION.has(protocol) && !URL.canParse(connectionString)) {
      return new UserFacingError('The provided database URL is not valid.')
    }

    if (isAccelerateProtocol(protocol)) {
      return new UserFacingError(ACCELERATE_UNSUPPORTED_MESSAGE)
    }

    const studioStuff = CONNECTION_STRING_PROTOCOL_TO_STUDIO_STUFF[protocol]

    if (!studioStuff) {
      return new UserFacingError(`Prisma Studio is not supported for the "${protocol}" protocol.`)
    }

    const executor = await studioStuff.createExecutor(
      connectionString,
      getUrlBasePath(args['--url'], config.loadedFromFile),
    )
    const version = packageJson.dependencies['@prisma/studio-core']
    const ppgDbInfo = await getPpgInfo(connectionString)
    const port = await resolveStudioPort(requestedPort)
    const handler = createStudioRequestHandler({
      adapter: studioStuff.adapter,
      executor,
      ppgDbInfo,
      port,
      protocol,
      version,
    })

    const url = `http://localhost:${port}`

    const server = startStudioServer({
      handler,
      onListen: () => {
        console.log(bold(`\nPrisma Studio is running at:`), url)

        const browser = args['--browser'] || process.env.BROWSER

        if (browser?.toLowerCase() !== 'none') {
          void open(url, { app: browser ? { name: browser } : undefined })
        }
      },
      port,
    })

    process.once('SIGINT', () => server.close())
    process.once('SIGTERM', () => server.close())

    return ''
  }
}

function createHelp(identity: CliDistributionIdentity): string {
  return format(`
Browse your data with Prisma Studio

${bold('Usage')}

  ${dim('$')} ${identity} studio [options]

${bold('Options')}

  -h, --help        Display this help message
  -p, --port        Port to start Studio on
  -b, --browser     Browser to open Studio in
  --config          Custom path to your Prisma config file
  --url             Database connection string (overrides the one in your Prisma config)

${bold('Examples')}

  Start Studio on the default port
    ${dim('$')} ${identity} studio

  Start Studio on a custom port
    ${dim('$')} ${identity} studio --port 5555

  Start Studio in a specific browser
    ${dim('$')} ${identity} studio --port 5555 --browser firefox
    ${dim('$')} BROWSER=firefox ${identity} studio --port 5555

  Start Studio without opening in a browser
    ${dim('$')} ${identity} studio --port 5555 --browser none
    ${dim('$')} BROWSER=none ${identity} studio --port 5555

  Specify a custom prisma config file
    ${dim('$')} ${identity} studio --config=./prisma7.config.ts

  Specify a direct database connection string
    ${dim('$')} ${identity} studio --url="postgresql://user:password@localhost:5432/dbname"
`)
}

function getUrlBasePath(url: string | undefined, configPath: string | null): string {
  return url ? process.cwd() : configPath ? dirname(configPath) : process.cwd()
}

async function resolveStudioPort(requestedPort: number | undefined): Promise<number> {
  if (requestedPort !== undefined) {
    return requestedPort
  }

  return getPort({
    host: STUDIO_SERVER_HOST,
    port: DEFAULT_PORT,
    portRange: [MIN_PORT, DEFAULT_PORT - 1],
  })
}

function serializeBffError(error: unknown): SerializedError {
  return getSerializedBffError(error) ?? serializeError(error)
}

function getSerializedBffError(error: unknown): SerializedError | null {
  if (isSerializedError(error)) {
    return error
  }

  if (!isRecord(error)) {
    return null
  }

  const nestedError = error.error

  if (isSerializedError(nestedError)) {
    return nestedError
  }

  const rpcSerializedError = error['@@error']

  if (isSerializedError(rpcSerializedError)) {
    return rpcSerializedError
  }

  return null
}

function isSerializedError(error: unknown): error is SerializedError {
  if (!isRecord(error)) {
    return false
  }

  if (typeof error.name !== 'string' || typeof error.message !== 'string') {
    return false
  }

  if (error.errors === undefined) {
    return true
  }

  return Array.isArray(error.errors) && error.errors.every(isSerializedError)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAccelerateProtocol(protocol: string): boolean {
  return protocol === 'prisma' || protocol === 'prisma+postgres'
}

function normalizeMySQLConnectionString(connectionString: string): string {
  const connectionURL = new URL(connectionString)

  const connectionLimit = connectionURL.searchParams.get('connection_limit')

  if (connectionLimit && !connectionURL.searchParams.has('connectionLimit')) {
    connectionURL.searchParams.set('connectionLimit', connectionLimit)
  }

  const sslAccept = connectionURL.searchParams.get('sslaccept')

  if (sslAccept && !connectionURL.searchParams.has('ssl')) {
    connectionURL.searchParams.set('ssl', JSON.stringify(prismaSslAcceptToMySQL2Ssl(sslAccept)))
  }

  for (const queryParameter of PRISMA_ORM_SPECIFIC_MYSQL_QUERY_PARAMETERS) {
    connectionURL.searchParams.delete(queryParameter)
  }

  return connectionURL.toString()
}

function prismaSslAcceptToMySQL2Ssl(sslAccept: string): { rejectUnauthorized: boolean } {
  switch (sslAccept) {
    case 'strict':
      return { rejectUnauthorized: true }
    case 'accept_invalid_certs':
      return { rejectUnauthorized: false }
    default:
      throw new Error(
        `Unknown Prisma MySQL sslaccept value "${sslAccept}". Supported values are "strict" and "accept_invalid_certs".`,
      )
  }
}

// prettier-ignore
function getIndexHtml(adapter: StudioAdapterType): string {
  return `<!doctype html>
<html lang="en" style="height: 100%">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" href="${PRISMA_LOGO_SVG_DATA_URL}" type="image/svg+xml">
    <link rel="stylesheet" href="/${STUDIO_CSS_FILE_NAME}">
    <style>
      html {
        height: 100%;
      }

      body {
        color: black;
        height: 100%;
        margin: 0;
        padding: 0;
      }

      #root {
        height: 100%;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__STUDIO_CONFIG__ = ${JSON.stringify({ adapter })};</script>
    <script type="module" src="/${STUDIO_JS_FILE_NAME}"></script>
  </body>
</html>`
}

function isGetOrHeadRequest(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

function createStudioRequestHandler({
  adapter,
  executor,
  ppgDbInfo,
  port,
  protocol,
  version,
}: {
  adapter: StudioAdapterType
  executor: Executor
  ppgDbInfo: Awaited<ReturnType<typeof getPpgInfo>>
  port: number
  protocol: string
  version: string
}): (request: Request) => Promise<Response> {
  let projectHash: string | null = null

  return async (request) => {
    if (!isAllowedStudioOrigin(request, port)) {
      return textResponse('Forbidden', 403)
    }

    const { pathname } = new URL(request.url)

    if (isGetOrHeadRequest(request.method) && pathname === '/') {
      const contentType = FILE_EXTENSION_TO_CONTENT_TYPE[extname('index.html')]

      return textResponse(getIndexHtml(adapter), 200, { 'Content-Type': contentType })
    }

    if (isGetOrHeadRequest(request.method) && pathname === '/favicon.ico') {
      return textResponse(PRISMA_LOGO_SVG, 200, { 'Content-Type': 'image/svg+xml' })
    }

    if (
      isGetOrHeadRequest(request.method) &&
      (pathname === `/${STUDIO_JS_FILE_NAME}` || pathname === `/${STUDIO_CSS_FILE_NAME}`)
    ) {
      return serveStudioAsset(pathname)
    }

    if (request.method === 'POST' && pathname === '/bff') {
      return handleStudioBffRequest(await request.json(), executor)
    }

    if (request.method === 'POST' && pathname === '/telemetry') {
      const { eventId, name, payload, timestamp } = (await request.json()) as Parameters<
        NonNullable<StudioProps['onEvent']>
      >[0]

      if (name !== 'studio_launched') {
        return emptyResponse(200)
      }

      const input: Check.Input = {
        check_if_update_available: false,
        client_event_id: eventId,
        command: name,
        information: JSON.stringify({
          eventPayload: payload,
          protocol,
          ...ppgDbInfo,
        }),
        local_timestamp: timestamp,
        product: 'prisma-studio-cli',
        project_hash: (projectHash ??= digest(process.cwd())),
        version,
      }

      await sendEvent(input).catch(() => {
        // noop
      })

      return emptyResponse(200)
    }

    return textResponse('Not Found', 404)
  }
}

async function handleStudioBffRequest(payload: unknown, executor: Executor): Promise<Response> {
  const request = payload as StudioBFFRequest
  const { procedure } = request

  if (procedure === 'query') {
    const [error, results] = await executor.execute(request.query)

    if (error) {
      return jsonResponse([serializeBffError(error)])
    }

    return jsonResponse([null, results])
  }

  if (procedure === 'sequence') {
    if (!('executeSequence' in executor)) {
      return jsonResponse([[serializeBffError(new Error('Executor does not support sequences'))]])
    }

    const [[error0, result0], maybeResult1] = await (executor as SequenceExecutor).executeSequence(request.sequence)

    if (error0) {
      return jsonResponse([[serializeBffError(error0)]])
    }

    const [error1, result1] = maybeResult1 || []

    if (error1) {
      return jsonResponse([[null, result0], [serializeBffError(error1)]])
    }

    return jsonResponse([
      [null, result0],
      [null, result1],
    ])
  }

  if (procedure === 'transaction') {
    if (!executor.executeTransaction) {
      return jsonResponse([serializeBffError(new Error('Executor does not support transactions'))])
    }

    const [error, results] = await executor.executeTransaction(request.queries)

    if (error) {
      return jsonResponse([serializeBffError(error)])
    }

    return jsonResponse([null, results])
  }

  if (procedure === 'sql-lint') {
    if (!executor.lintSql) {
      return jsonResponse([serializeBffError(new Error('Executor does not support SQL lint'))])
    }

    const [error, result] = await executor.lintSql({
      schemaVersion: request.schemaVersion,
      sql: request.sql,
    })

    if (error) {
      return jsonResponse([serializeBffError(error)])
    }

    return jsonResponse([null, result])
  }

  if (procedure === 'query-insights') {
    return jsonResponse([serializeError(new Error('Executor does not support query insights'))])
  }

  procedure satisfies undefined

  return textResponse('Unknown procedure', 500)
}

async function serveStudioAsset(requestPath: string): Promise<Response> {
  const fileName = requestPath.substring(1)
  const contentType = FILE_EXTENSION_TO_CONTENT_TYPE[extname(fileName)]

  try {
    return new Response(await readStudioAsset(fileName), {
      headers: { 'Content-Type': contentType },
      status: 200,
    })
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return textResponse('Not Found', 404)
    }

    return textResponse('Internal Server Error', 500)
  }
}

async function readStudioAsset(fileName: string): Promise<Buffer | string> {
  const triedPaths: string[] = []

  for (const directory of getStudioAssetDirectories()) {
    const filePath = join(directory, fileName)
    triedPaths.push(filePath)

    try {
      return await readFile(filePath)
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error
      }
    }
  }

  const error = new Error(`Prisma Studio asset "${fileName}" was not found.`) as Error & { code?: string }
  error.code = 'ENOENT'
  error.message = `${error.message}\nSearched in:\n${triedPaths.map((filePath) => `- ${filePath}`).join('\n')}`
  throw error
}

function getStudioAssetDirectories(): string[] {
  return [...new Set([__dirname, join(__dirname, '..', 'build')])]
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function jsonResponse(payload: unknown): Response {
  return Response.json(payload)
}

function emptyResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { headers, status })
}

function textResponse(text: string, status: number, headers?: Record<string, string>): Response {
  return new Response(text, {
    headers,
    status,
  })
}

function isAllowedStudioOrigin(request: Request, port: number): boolean {
  const origin = request.headers.get('Origin')

  if (origin === null) {
    return true
  }

  try {
    const normalizedOrigin = new URL(origin).origin

    return (
      normalizedOrigin === new URL(`http://localhost:${port}`).origin ||
      normalizedOrigin === new URL(`http://127.0.0.1:${port}`).origin
    )
  } catch {
    return false
  }
}
