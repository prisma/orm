import path from 'node:path'

import { DataSource } from '@prisma/generator'
import type { DatabaseCredentials, PrismaConfigWithDatasource } from '@prisma/internals'
import { canConnectToDatabase, createDatabase, PRISMA_POSTGRES_PROVIDER, uriToCredentials } from '@prisma/internals'
import { bold } from 'kleur/colors'

import { ConnectorType } from './printDatasources'
import { getSocketFromDatabaseCredentials } from './unixSocket'

export type MigrateAction = 'create' | 'apply' | 'unapply' | 'dev' | 'push'
export type PrettyProvider =
  | 'MySQL'
  | 'PostgreSQL'
  | 'Prisma Postgres'
  | 'SQLite'
  | 'SQL Server'
  | 'CockroachDB'
  | 'MongoDB'

// TODO: extract functions in their own files?

export type DatasourceInfo = {
  name?: string // from datasource name
  prettyProvider?: PrettyProvider // pretty name for the provider
  url?: string // from getConfig
  dbLocation?: string // host without credentials
  dbName?: string // database name
  schema?: string // database schema (!= multiSchema, can be found in the connection string like `?schema=myschema`)
  schemas?: string[] // database schemas from the datasource (multiSchema feature)
}

export function parseDatasourceInfo(
  datasource: DataSource | undefined,
  config: PrismaConfigWithDatasource,
): DatasourceInfo {
  const url = config.datasource.url

  if (!datasource) {
    return {
      name: undefined,
      prettyProvider: undefined,
      dbName: undefined,
      dbLocation: undefined,
      url,
      schema: undefined,
      schemas: undefined,
    }
  }

  const prettyProvider = prettifyProvider(datasource.provider)

  // url parsing for sql server is not implemented
  if (datasource.provider === 'sqlserver') {
    return {
      name: datasource.name,
      prettyProvider,
      dbName: undefined,
      dbLocation: undefined,
      url,
      schema: undefined,
      schemas: datasource.schemas,
    }
  }

  try {
    const credentials = uriToCredentials(url)
    const dbLocation = getDbLocation(credentials)

    let schema: string | undefined = undefined
    if (['postgresql', 'cockroachdb'].includes(datasource.provider)) {
      if (credentials.schema) {
        schema = credentials.schema
      } else {
        schema = 'public'
      }
    }

    const datasourceInfo = {
      name: datasource.name,
      prettyProvider,
      dbName: credentials.database,
      dbLocation,
      url,
      schema,
      schemas: datasource.schemas,
      configDir: path.dirname(datasource.sourceFilePath),
    }

    // Default to `postgres` database name for PostgreSQL
    // It's not 100% accurate but it's the best we can do here
    if (datasource.provider === 'postgresql' && datasourceInfo.dbName === undefined) {
      datasourceInfo.dbName = 'postgres'
    }

    return datasourceInfo
  } catch (e) {
    return {
      name: datasource.name,
      prettyProvider,
      dbName: undefined,
      dbLocation: undefined,
      url,
      schema: undefined,
      schemas: datasource.schemas,
    }
  }
}

/**
 * Check if we can connect to the database and throw an error otherwise.
 */
export async function ensureCanConnectToDatabase(
  pathResolutionRoot: string,
  config: PrismaConfigWithDatasource,
): Promise<void> {
  const url = config.datasource.url

  const canConnect = await canConnectToDatabase(url, pathResolutionRoot)

  if (canConnect === true) {
    return
  } else {
    const { code, message } = canConnect
    throw new Error(`${code}: ${message}`)
  }
}

type SuccessMessage = string

export async function ensureDatabaseExists(
  pathResolutionRoot: string,
  provider: ConnectorType,
  config: PrismaConfigWithDatasource,
): Promise<SuccessMessage | undefined> {
  const url = config.datasource.url

  const canConnect = await canConnectToDatabase(url, pathResolutionRoot)
  if (canConnect === true) {
    return
  }
  const { code, message } = canConnect

  // P1003 means we can connect but that the database doesn't exist
  if (code !== 'P1003') {
    throw new Error(`${code}: ${message}`)
  }

  if (await createDatabase(url, pathResolutionRoot)) {
    // URI parsing is not implemented for SQL server yet
    if (provider === 'sqlserver') {
      return `SQL Server database created.\n`
    }

    // parse the url
    const credentials = uriToCredentials(url)
    const prettyProvider = prettifyProvider(provider)

    let message = `${prettyProvider} database${credentials.database ? ` ${credentials.database} ` : ' '}created`
    const dbLocation = getDbLocation(credentials)
    if (dbLocation) {
      message += ` at ${bold(dbLocation)}`
    }

    return message
  }

  return undefined
}

// returns the "host" like localhost / 127.0.0.1 + default port
export function getDbLocation(credentials: DatabaseCredentials): string | undefined {
  if (credentials.type === 'sqlite') {
    return credentials.uri!
  }

  const socket = getSocketFromDatabaseCredentials(credentials)

  if (socket) {
    return `unix:${socket}`
  } else if (credentials.host && credentials.port) {
    return `${credentials.host}:${credentials.port}`
  } else if (credentials.host) {
    return `${credentials.host}`
  }

  return undefined
}

/**
 * Return a pretty version of a "provider" (with uppercase characters)
 * @param provider
 * @returns PrettyProvider
 */
export function prettifyProvider(provider: ConnectorType): PrettyProvider {
  switch (provider) {
    case 'mysql':
      return `MySQL`
    case 'postgres':
    case 'postgresql':
      return `PostgreSQL`
    case PRISMA_POSTGRES_PROVIDER:
      return `Prisma Postgres`
    case 'sqlite':
      return `SQLite`
    case 'cockroachdb':
      return `CockroachDB`
    case 'sqlserver':
      return `SQL Server`
    case 'mongodb':
      return `MongoDB`
  }
}
