import { Error as DriverAdapterErrorObject, MappedError } from '@prisma/driver-adapter-utils'
import type { DatabaseError } from 'pg'

const TLS_ERRORS = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_CRL',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'UNABLE_TO_DECRYPT_CRL_SIGNATURE',
  'UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY',
  'CERT_SIGNATURE_FAILURE',
  'CRL_SIGNATURE_FAILURE',
  'CERT_NOT_YET_VALID',
  'CERT_HAS_EXPIRED',
  'CRL_NOT_YET_VALID',
  'CRL_HAS_EXPIRED',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'ERROR_IN_CRL_LAST_UPDATE_FIELD',
  'ERROR_IN_CRL_NEXT_UPDATE_FIELD',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_CHAIN_TOO_LONG',
  'CERT_REVOKED',
  'INVALID_CA',
  'INVALID_PURPOSE',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_FORMAT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

const SOCKET_ERRORS = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'])

export function convertDriverError(error: unknown): DriverAdapterErrorObject {
  if (isSocketError(error)) {
    return mapSocketError(error)
  }

  if (isTlsError(error)) {
    return {
      kind: 'TlsConnectionError',
      reason: error.message,
    }
  }

  if (isDriverError(error)) {
    return {
      originalCode: error.code,
      originalMessage: error.message,
      ...mapDriverError(error),
    }
  }

  throw error
}

function mapDriverError(error: DatabaseError): MappedError {
  switch (error.code) {
    case '22001':
      return {
        kind: 'LengthMismatch',
        column: error.column,
      }
    case '22003':
      return {
        kind: 'ValueOutOfRange',
        cause: error.message,
      }
    case '22P02':
      return {
        kind: 'InvalidInputValue',
        message: error.message,
      }
    case '23505': {
      const fields = error.detail
        ?.match(/Key \(([^)]+)\)/)
        ?.at(1)
        ?.split(', ')

      let constraint: { fields: string[] } | { index: string } | undefined
      if (error.constraint) {
        constraint = { index: error.constraint }
      } else if (fields !== undefined) {
        constraint = { fields }
      }

      // CockroachDB does not populate `error.table` (unlike PostgreSQL,
      // which reports the bare table name there), so we recover the table
      // name from constraints following Prisma's default naming convention
      // for unique constraints, `{table}_{field1}_..._{fieldN}_key`, by
      // stripping the fields (parsed above from `error.detail`) and the
      // trailing `_key` off the constraint name. Custom-named constraints
      // (`@@unique(map: ...)`) yield no table name here, in which case the
      // client falls back to the top-level operation's model name.
      let table = error.table
      if (table === undefined && fields !== undefined && fields.length > 0) {
        const suffix = `_${fields.join('_')}_key`
        if (error.constraint?.endsWith(suffix)) {
          table = error.constraint.slice(0, -suffix.length)
        }
      }

      return {
        kind: 'UniqueConstraintViolation',
        constraint,
        table,
      }
    }
    case '23502': {
      const fields = error.detail
        ?.match(/Key \(([^)]+)\)/)
        ?.at(1)
        ?.split(', ')
      return {
        kind: 'NullConstraintViolation',
        constraint: fields !== undefined ? { fields } : undefined,
      }
    }
    case '23503': {
      let constraint: { fields: string[] } | { index: string } | undefined

      if (error.column) {
        constraint = { fields: [error.column] }
      } else if (error.constraint) {
        constraint = { index: error.constraint }
      }

      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint,
      }
    }
    case '23001': {
      let constraint: { fields: string[] } | { index: string } | undefined

      if (error.column) {
        constraint = { fields: [error.column] }
      } else if (error.constraint) {
        constraint = { index: error.constraint }
      }

      return {
        kind: 'RestrictViolation',
        constraint,
      }
    }
    case '3D000':
      return {
        kind: 'DatabaseDoesNotExist',
        db: error.message.split(' ').at(1)?.split('"').at(1),
      }
    case '28000':
      return {
        kind: 'DatabaseAccessDenied',
        db: error.message
          .split(',')
          .find((s) => s.startsWith(' database'))
          ?.split('"')
          .at(1),
      }
    case '28P01':
      return {
        kind: 'AuthenticationFailed',
        user: error.message.split(' ').pop()?.split('"').at(1),
      }
    case '40001':
    case '40P01':
      return {
        kind: 'TransactionWriteConflict',
      }
    case '42P01':
      return {
        kind: 'TableDoesNotExist',
        table: error.message.split(' ').at(1)?.split('"').at(1),
      }
    case '42703': {
      const rawColumn = error.message.match(/^column (.+) does not exist$/)?.at(1)
      return {
        kind: 'ColumnNotFound',
        column: rawColumn?.replace(/"((?:""|[^"])*)"/g, (_, id) => id.replaceAll('""', '"')),
      }
    }
    case '42P04':
      return {
        kind: 'DatabaseAlreadyExists',
        db: error.message.split(' ').at(1)?.split('"').at(1),
      }
    case '53300':
      return {
        kind: 'TooManyConnections',
        cause: error.message,
      }
    default:
      return {
        kind: 'postgres',
        code: error.code ?? 'N/A',
        severity: error.severity ?? 'N/A',
        message: error.message,
        detail: error.detail,
        column: error.column,
        hint: error.hint,
      }
  }
}

function isDriverError(error: any): error is DatabaseError {
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.severity === 'string' &&
    (typeof error.detail === 'string' || error.detail === undefined) &&
    (typeof error.column === 'string' || error.column === undefined) &&
    (typeof error.hint === 'string' || error.hint === undefined)
  )
}

type SocketError = Error & {
  code: 'ENOTFOUND' | 'ECONNREFUSED' | 'ECONNRESET' | 'ETIMEDOUT'
  syscall: string
  errno: number
  address?: string | undefined
  port?: number | undefined
  hostname?: string | undefined
}

function mapSocketError(error: SocketError): MappedError {
  switch (error.code) {
    case 'ENOTFOUND':
    case 'ECONNREFUSED':
      return {
        kind: 'DatabaseNotReachable',
        host: error.address ?? error.hostname,
        port: error.port,
      }
    case 'ECONNRESET':
      return {
        kind: 'ConnectionClosed',
      }
    case 'ETIMEDOUT':
      return {
        kind: 'SocketTimeout',
      }
  }
}

function isSocketError(error: any): error is Error & {
  code: 'ENOTFOUND' | 'ECONNREFUSED' | 'ECONNRESET' | 'ETIMEDOUT'
  syscall: string
  errno: number
  address?: string
  port?: number
  hostname?: string
} {
  return (
    typeof error.code === 'string' &&
    typeof error.syscall === 'string' &&
    typeof error.errno === 'number' &&
    SOCKET_ERRORS.has(error.code as string)
  )
}

function isTlsError(error: any): error is Error & { code?: string } {
  if (typeof error.code === 'string') {
    return TLS_ERRORS.has(error.code as string)
  }

  //Base Errors thrown by pg.Connection.connect() when SSL is enabled
  //but the server responds with error code S or N
  switch (error.message) {
    case 'The server does not support SSL connections':
    case 'There was an error establishing an SSL connection':
      return true
  }

  return false
}
