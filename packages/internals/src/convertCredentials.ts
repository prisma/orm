import type { ConnectorType } from '@prisma/generator'
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

  return url.toString()
}

// opposite of credentialsToUri
// maybe rename, since it's about returning a parsed uri object? connection info?
export function uriToCredentials(connectionString: string): DatabaseCredentials {
  // rename to url everywhere?
  let uri: NodeURL.URL
  try {
    uri = new NodeURL.URL(connectionString)
  } catch (e) {
    throw new Error('Invalid data source URL, see https://pris.ly/d/config-url')
  }

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

  return {
    type,
    host: exists(uri.hostname) ? uri.hostname : undefined,
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
