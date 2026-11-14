import type { ConnectorType } from '@prisma/generator-helper'
import path from 'path'
import * as NodeURL from 'url'

import type { DatabaseCredentials } from './types'
import { PRISMA_POSTGRES_PROTOCOL } from './utils/prismaPostgres'

// opposite of uriToCredentials
// only used for internal tests
export function credentialsToUri(credentials: DatabaseCredentials): string {
  const type = databaseTypeToProtocol(credentials.type)
  if (credentials.type === 'sqlite') {
    // if `file:../parent-dev.db` return as it is
    return credentials.uri!
  }

  // construct URL object with protocol
  const url = new NodeURL.URL(type + '//')

  if (credentials.host) {
    url.hostname = credentials.host
  }

  if (credentials.type === 'postgresql') {
    if (credentials.database) {
      url.pathname = '/' + credentials.database
    }

    if (credentials.schema) {
      url.searchParams.set('schema', credentials.schema)
    }

    if (credentials.socket) {
      url.host = credentials.socket
    }
  } else if (credentials.type === 'mysql') {
    // why `credentials.schema` in mysql here? doesn't exist for mysql
    // try removing it and see how the tests react
    url.pathname = '/' + (credentials.database || credentials.schema || '')
    if (credentials.socket) {
      url.searchParams.set('socket', credentials.socket)
    }
  } else if (credentials.type === 'mongodb') {
    url.pathname = '/' + credentials.database
  }

  if (credentials.ssl) {
    // don't understand why hardcoding prefer? we should put the value here?
    url.searchParams.set('sslmode', 'prefer')
  }

  const hasEmptyHostWithAuth =
    !credentials.host &&
    !credentials.socket &&
    Boolean(credentials.user || credentials.password || credentials.port)

  if (hasEmptyHostWithAuth) {
    url.hostname = '__prisma_empty_host__'
  }

  if (credentials.user) {
    url.username = credentials.user
  }

  if (credentials.password) {
    url.password = credentials.password
  }

  if (credentials.port) {
    url.port = String(credentials.port)
  }

  url.host = `${url.hostname}${url.port ? `:${url.port}` : ''}`

  if (credentials.extraFields) {
    for (const [key, value] of Object.entries(credentials.extraFields)) {
      url.searchParams.set(key, value)
    }
  }

  // trim away empty pathnames
  if (url.pathname === '/') {
    url.pathname = ''
  }

  const serialized = url.toString()
  if (hasEmptyHostWithAuth) {
    return serialized.replace('__prisma_empty_host__', '')
  }
  return serialized
}

// opposite of credentialsToUri
// maybe rename, since it's about returning a parsed uri object? connection info?
const EMPTY_HOST_PLACEHOLDER = '__prisma_empty_host__'

function parseUrlAllowingBlankHost(connectionString: string): {
  uri: NodeURL.URL
  usedPlaceholderHost: boolean
} {
  try {
    return { uri: new NodeURL.URL(connectionString), usedPlaceholderHost: false }
  } catch (e) {
    // Handle connection strings where user/password/port is provided with a blank host
    // (e.g. postgresql://user@/mydb, postgresql://:pass@/mydb, postgresql://@/mydb, postgresql://:5432/mydb)
    const normalized = connectionString
      .replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]*@)(?=[/?#]|$)/, `$1${EMPTY_HOST_PLACEHOLDER}`)
      .replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(:\d+)(?=[/?#]|$)/, `$1${EMPTY_HOST_PLACEHOLDER}$2`)

    if (normalized !== connectionString) {
      try {
        return { uri: new NodeURL.URL(normalized), usedPlaceholderHost: true }
      } catch {
        // Fall through to standard error below
      }
    }

    throw new Error(
      'Invalid data source URL, see https://www.prisma.io/docs/reference/database-reference/connection-urls',
    )
  }
}

export function uriToCredentials(connectionString: string): DatabaseCredentials {
  // rename to url everywhere?
  const { uri, usedPlaceholderHost } = parseUrlAllowingBlankHost(connectionString)

  const type = protocolToConnectorType(uri.protocol)

  // needed, as the URL implementation adds empty strings
  const exists = (str): boolean => str && str.length > 0

  const extraFields = {}
  const schema = uri.searchParams.get('schema')
  const socket = uri.searchParams.get('socket')

  for (const [name, value] of uri.searchParams) {
    if (!['schema', 'socket'].includes(name)) {
      extraFields[name] = value
    }
  }

  let database: string | undefined = undefined

  if (type === 'sqlite' && uri.pathname) {
    // weird conditionals here
    if (uri.pathname.startsWith('file:')) {
      database = uri.pathname.slice(5)
    } else {
      // here it's only the file name?
      database = path.basename(uri.pathname)
    }
  }
  // why length more than 1?
  // probably for slicing `/` or `?`?
  else if (uri.pathname.length > 1) {
    database = uri.pathname.slice(1)

    // if after slicing "database" is empty
    if (type === 'postgresql' && !database) {
      // use postgres as default, it's 99% accurate
      // could also be template1 for example in rare cases
      database = 'postgres'
    }
  }

  const rawHostname = usedPlaceholderHost && uri.hostname === EMPTY_HOST_PLACEHOLDER ? '' : uri.hostname

  return {
    type,
    host: exists(rawHostname) ? rawHostname : undefined,
    user: exists(uri.username) ? uri.username : undefined,
    port: exists(uri.port) ? Number(uri.port) : undefined,
    password: exists(uri.password) ? uri.password : undefined,
    database,
    schema: schema || undefined,
    uri: connectionString,
    ssl: Boolean(uri.searchParams.get('sslmode')),
    socket: socket || undefined,
    extraFields,
  }
}

// do we need a function for that?
function databaseTypeToProtocol(databaseType: ConnectorType) {
  switch (databaseType) {
    case 'postgresql':
    case 'cockroachdb':
      return 'postgresql:'
    case 'mysql':
      return 'mysql:'
    case 'mongodb':
      return 'mongodb:'
    case 'sqlite':
      return 'file:'
    case 'sqlserver':
      return 'sqlserver:'
  }

  throw new Error(`Unknown databaseType ${databaseType}`)
}

/**
 * Convert a protocol to the equivalent database connector type.
 * Throws an error if the protocol is not recognized.
 * @param protocol e.g., 'postgres:'
 */
export function protocolToConnectorType(protocol: string): ConnectorType {
  switch (protocol) {
    case 'postgresql:':
    case 'postgres:':
    case PRISMA_POSTGRES_PROTOCOL:
      return 'postgresql'
    case 'mongodb+srv:':
    case 'mongodb:':
      return 'mongodb'
    case 'mysql:':
      return 'mysql'
    case 'file:':
      return 'sqlite'
    case 'sqlserver:':
      return 'sqlserver'
  }

  throw new Error(`Unknown protocol ${protocol}`)
}
