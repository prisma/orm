import os from 'node:os'

export interface LocalDatabaseCredentials {
  type: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
}

/**
 * Normalizes PostgreSQL and MySQL connection credentials when host or user
 * are omitted in DATABASE_URL (e.g. "postgresql:///mydb" or "postgresql://localhost/mydb"),
 * matching libpq / psql defaults (host -> PGHOST || 'localhost', user -> PGUSER || os.userInfo().username).
 *
 * Fixes https://github.com/prisma/orm/issues/8230
 */
export function normalizeLocalDatabaseCredentials<T extends LocalDatabaseCredentials>(credentials: T): T {
  const isPostgresOrMysql =
    credentials.type === 'postgresql' || credentials.type === 'postgres' || credentials.type === 'mysql'
  if (!isPostgresOrMysql) {
    return credentials
  }
  return {
    ...credentials,
    host: credentials.host || process.env.PGHOST || 'localhost',
    user: credentials.user || process.env.PGUSER || os.userInfo().username,
  }
}
