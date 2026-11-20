import type { ConnectorType } from '@prisma/generator'

export interface DatabaseCredentials {
  type: ConnectorType
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  alreadyData?: boolean
  schema?: string
  newSchema?: string
  ssl?: boolean
  uri?: string
  executeRaw?: boolean
  socket?: string
  extraFields?: { [key: string]: string }
}

/**
 * Given a type T and a key K, return a new type that is T + the key K marked as required.
 * E.g.:
 * ```
 * type T = {
 *   a?: string
 *   b: number
 *   c?: string
 *   d?: boolean
 * }
 * type R = RequireKey<T, 'a' | 'c'>
 * // R is { a: string, b: number, c: string, d?: boolean }
 * ```
 */
export type RequireKey<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>
