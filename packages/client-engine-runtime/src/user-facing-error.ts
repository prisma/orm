import { DriverAdapterError, isDriverAdapterError } from '@prisma/driver-adapter-utils'

import { assertNever, safeJsonStringify } from './utils'

export class UserFacingError extends Error {
  name = 'UserFacingError'
  code: string
  meta: Record<string, unknown>

  constructor(message: string, code: string, meta?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.meta = meta ?? {}
  }

  toQueryResponseErrorObject() {
    return {
      error: this.message,
      user_facing_error: {
        is_panic: false,
        message: this.message,
        meta: this.meta,
        error_code: this.code,
      },
    }
  }
}

export function rethrowAsUserFacing(error: any): never {
  if (!isDriverAdapterError(error)) {
    throw error
  }

  const code = getErrorCode(error)
  const message = renderErrorMessage(error)
  if (code !== undefined && message !== undefined) {
    const meta: Record<string, unknown> = { driverAdapterError: error }
    if (error.cause.kind === 'UniqueConstraintViolation' && error.cause.table) {
      meta.table = error.cause.table
    }
    throw new UserFacingError(message, code, meta)
  }

  // No specific mapping exists for this error kind. For database-specific
  // kinds (`postgres`, `mysql`, `sqlite`, `mssql`) this happens when the
  // adapter doesn't recognize the underlying database error code. Falling
  // back to a P2039 user-facing error with the raw database code and
  // message ensures that:
  //
  //   1. Locally, the error surfaces as a `PrismaClientKnownRequestError`
  //      that users can catch and inspect, instead of an opaque
  //      `PrismaClientUnknownRequestError`.
  //   2. The query plan executor returns HTTP 400 with the full error
  //      details instead of HTTP 500. This matters for Accelerate, which
  //      strips the response body on 500 responses and would otherwise
  //      hide the real error from the user.
  //
  // These cases are not necessarily bugs — they routinely occur when the
  // database schema is out of sync with the Prisma schema (e.g. a migration
  // hasn't been applied, or the client hasn't been regenerated after a
  // schema change), so we need to make the underlying database error
  // visible to the user.
  //
  // We use a distinct code (P2039) from the raw-query path (P2010,
  // "Raw query failed.") so that the error message doesn't claim a
  // non-raw query is a raw one.
  if (isGenericDatabaseErrorKind(error.cause.kind)) {
    throw buildUnmappedDatabaseUserFacingError(error)
  }

  throw error
}

export function rethrowAsUserFacingRawError(error: any): never {
  if (!isDriverAdapterError(error)) {
    throw error
  }

  throw buildRawQueryUserFacingError(error)
}

function buildRawQueryUserFacingError(error: DriverAdapterError): UserFacingError {
  const code = error.cause.originalCode ?? 'N/A'
  const message = pickErrorMessage(error)
  return new UserFacingError(`Raw query failed. Code: \`${code}\`. Message: \`${message}\``, 'P2010', {
    driverAdapterError: error,
  })
}

function buildUnmappedDatabaseUserFacingError(error: DriverAdapterError): UserFacingError {
  const code = error.cause.originalCode ?? 'N/A'
  const message = pickErrorMessage(error)
  return new UserFacingError(`Database error. Code: \`${code}\`. Message: \`${message}\``, 'P2039', {
    driverAdapterError: error,
  })
}

/**
 * Picks the most informative human-readable message available for a driver
 * adapter error, falling back through:
 *   1. `originalMessage` set by the adapter (always present for known DB
 *      kinds; the raw error string from the underlying driver),
 *   2. the per-kind message rendered by `renderErrorMessage()`,
 *   3. the `DriverAdapterError`'s own `message` (which is either the
 *      cause's `message` field or the cause's `kind` name).
 *
 * Note that no member of the `MappedError` union is required to carry a
 * `message` field, so all three steps may be missing data; the final
 * fallback to `'N/A'` exists so we never interpolate `undefined` into a
 * user-facing message.
 */
function pickErrorMessage(error: DriverAdapterError): string {
  return error.cause.originalMessage ?? renderErrorMessage(error) ?? error.message ?? 'N/A'
}

function isGenericDatabaseErrorKind(kind: DriverAdapterError['cause']['kind']): boolean {
  switch (kind) {
    case 'postgres':
    case 'mysql':
    case 'sqlite':
    case 'mssql':
      return true
    default:
      return false
  }
}

function getErrorCode(err: DriverAdapterError): string | undefined {
  switch (err.cause.kind) {
    case 'AuthenticationFailed':
      return 'P1000'
    case 'DatabaseNotReachable':
      return 'P1001'
    case 'DatabaseDoesNotExist':
      return 'P1003'
    case 'SocketTimeout':
      return 'P1008'
    case 'DatabaseAlreadyExists':
      return 'P1009'
    case 'DatabaseAccessDenied':
      return 'P1010'
    case 'TlsConnectionError':
      return 'P1011'
    case 'ConnectionClosed':
      return 'P1017'
    case 'TransactionAlreadyClosed':
      return 'P1018'
    case 'LengthMismatch':
      return 'P2000'
    case 'UniqueConstraintViolation':
      return 'P2002'
    case 'ForeignKeyConstraintViolation':
    case 'RestrictViolation':
      return 'P2003'
    case 'InvalidInputValue':
      return 'P2007'
    case 'UnsupportedNativeDataType':
      return 'P2010'
    case 'NullConstraintViolation':
      return 'P2011'
    case 'ValueOutOfRange':
      return 'P2020'
    case 'TableDoesNotExist':
      return 'P2021'
    case 'ColumnNotFound':
      return 'P2022'
    case 'InvalidIsolationLevel':
    case 'InconsistentColumnData':
      return 'P2023'
    case 'MissingFullTextSearchIndex':
      return 'P2030'
    case 'TransactionWriteConflict':
      return 'P2034'
    case 'GenericJs':
      return 'P2036'
    case 'TooManyConnections':
      return 'P2037'
    case 'postgres':
    case 'sqlite':
    case 'mysql':
    case 'mssql':
      return
    default:
      assertNever(err.cause, `Unknown error: ${safeJsonStringify(err.cause)}`)
  }
}

function renderErrorMessage(err: DriverAdapterError): string | undefined {
  switch (err.cause.kind) {
    case 'AuthenticationFailed': {
      const user = err.cause.user ?? '(not available)'
      return `Authentication failed against the database server, the provided database credentials for \`${user}\` are not valid`
    }
    case 'DatabaseNotReachable': {
      const address = err.cause.host && err.cause.port ? `${err.cause.host}:${err.cause.port}` : err.cause.host
      return `Can't reach database server${address ? ` at ${address}` : ''}`
    }
    case 'DatabaseDoesNotExist': {
      const db = err.cause.db ?? '(not available)'
      return `Database \`${db}\` does not exist on the database server`
    }
    case 'SocketTimeout':
      return `Operation has timed out`
    case 'DatabaseAlreadyExists': {
      const db = err.cause.db ?? '(not available)'
      return `Database \`${db}\` already exists on the database server`
    }
    case 'DatabaseAccessDenied': {
      const db = err.cause.db ?? '(not available)'
      return `User was denied access on the database \`${db}\``
    }
    case 'TlsConnectionError': {
      return `Error opening a TLS connection: ${err.cause.reason}`
    }
    case 'ConnectionClosed': {
      return 'Server has closed the connection.'
    }
    case 'TransactionAlreadyClosed':
      return err.cause.cause
    case 'LengthMismatch': {
      const column = err.cause.column ?? '(not available)'
      return `The provided value for the column is too long for the column's type. Column: ${column}`
    }
    case 'UniqueConstraintViolation':
      return `Unique constraint failed on the ${renderConstraint(err.cause.constraint)}`
    case 'ForeignKeyConstraintViolation':
    case 'RestrictViolation':
      return `Foreign key constraint violated on the ${renderConstraint(err.cause.constraint)}`
    case 'UnsupportedNativeDataType':
      return `Failed to deserialize column of type '${err.cause.type}'. If you're using $queryRaw and this column is explicitly marked as \`Unsupported\` in your Prisma schema, try casting this column to any supported Prisma type such as \`String\`.`
    case 'NullConstraintViolation':
      return `Null constraint violation on the ${renderConstraint(err.cause.constraint)}`
    case 'ValueOutOfRange':
      return `Value out of range for the type: ${err.cause.cause}`
    case 'TableDoesNotExist': {
      const table = err.cause.table ?? '(not available)'
      return `The table \`${table}\` does not exist in the current database.`
    }
    case 'ColumnNotFound': {
      const column = err.cause.column ?? '(not available)'
      return `The column \`${column}\` does not exist in the current database.`
    }
    case 'InvalidIsolationLevel':
      return `Error in connector: Conversion error: ${err.cause.level}`
    case 'InconsistentColumnData':
      return `Inconsistent column data: ${err.cause.cause}`
    case 'MissingFullTextSearchIndex':
      return 'Cannot find a fulltext index to use for the native search, try adding a @@fulltext([Fields...]) to your schema'
    case 'TransactionWriteConflict':
      return `Transaction failed due to a write conflict or a deadlock. Please retry your transaction`
    case 'GenericJs':
      return `Error in external connector (id ${err.cause.id})`
    case 'TooManyConnections':
      return `Too many database connections opened: ${err.cause.cause}`
    case 'InvalidInputValue':
      return `Invalid input value: ${err.cause.message}`
    case 'sqlite':
    case 'postgres':
    case 'mysql':
    case 'mssql':
      return
    default:
      assertNever(err.cause, `Unknown error: ${safeJsonStringify(err.cause)}`)
  }
}

function renderConstraint(constraint?: { fields: string[] } | { index: string } | { foreignKey: {} }): string {
  if (constraint && 'fields' in constraint) {
    return `fields: (${constraint.fields.map((field) => `\`${field}\``).join(', ')})`
  } else if (constraint && 'index' in constraint) {
    return `constraint: \`${constraint.index}\``
  } else if (constraint && 'foreignKey' in constraint) {
    return `foreign key`
  }
  return '(not available)'
}
