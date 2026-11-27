import { type LibsqlError } from '@libsql/client'
import { Error as DriverAdapterErrorObject, MappedError } from '@prisma/driver-adapter-utils'

const SQLITE_BUSY = 5
const PRIMARY_ERROR_CODE_MASK = 0xff

export function convertDriverError(error: unknown): DriverAdapterErrorObject {
  if (isDriverError(error)) {
    return {
      originalCode: error.rawCode?.toString(),
      originalMessage: error.message,
      ...mapDriverError(error),
    }
  }

  throw error
}

export function mapDriverError(error: LibsqlError): MappedError {
  const rawCode: number = error.rawCode ?? error.cause?.['rawCode'] ?? constraintCodeFromMessage(error) ?? 1
  switch (rawCode) {
    case 2067:
    case 1555: {
      const columns = error.message.split('constraint failed: ').at(1)?.split(', ')
      const fields = columns?.map((field) => field.split('.').pop()!)
      // SQLite reports the violated columns as `<table>.<column>`; when the
      // first entry has no table prefix, no table name can be derived.
      const table = columns?.at(0)?.split('.').slice(0, -1).join('.') || undefined
      return {
        kind: 'UniqueConstraintViolation',
        constraint: fields !== undefined ? { fields } : undefined,
        table,
      }
    }
    case 1299: {
      const fields = error.message
        .split('constraint failed: ')
        .at(1)
        ?.split(', ')
        .map((field) => field.split('.').pop()!)
      return {
        kind: 'NullConstraintViolation',
        constraint: fields !== undefined ? { fields } : undefined,
      }
    }
    case 787:
    case 1811:
      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint: { foreignKey: {} },
      }
    default:
      if (rawCode && (rawCode & PRIMARY_ERROR_CODE_MASK) === SQLITE_BUSY) {
        return {
          kind: 'SocketTimeout',
        }
      } else if (error.message.startsWith('no such table')) {
        return {
          kind: 'TableDoesNotExist',
          table: error.message.split(': ').at(1),
        }
      } else if (error.message.startsWith('no such column')) {
        return {
          kind: 'ColumnNotFound',
          column: error.message.split(': ').at(1),
        }
      } else if (error.message.includes('has no column named ')) {
        return {
          kind: 'ColumnNotFound',
          column: error.message.split('has no column named ').at(1),
        }
      }

      return {
        kind: 'sqlite',
        extendedCode: rawCode,
        message: error.message,
      }
  }
}

function isDriverError(error: any): error is LibsqlError {
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    (typeof error.rawCode === 'number' || error.rawCode === undefined)
  )
}

const CONSTRAINT_CODES_BY_MESSAGE: [header: string, extendedCode: number][] = [
  ['UNIQUE constraint failed', 2067],
  ['PRIMARY KEY constraint failed', 1555],
  ['NOT NULL constraint failed', 1299],
  ['FOREIGN KEY constraint failed', 787],
]

const REMOTE_ERROR_PREFIX = /^(?:[A-Z_]+: )*(?:SQLite error: )?/

/**
 * Errors from a remote libSQL server carry only the primary `SQLITE_CONSTRAINT`
 * code and no numeric `rawCode`, so the extended code is recovered from
 * SQLite's message. Only the start of the message is matched, since the table
 * and column names that follow it can contain any text.
 */
function constraintCodeFromMessage(error: LibsqlError): number | undefined {
  if (!error.code.startsWith('SQLITE_CONSTRAINT')) {
    return undefined
  }
  const message = error.message.replace(REMOTE_ERROR_PREFIX, '')
  return CONSTRAINT_CODES_BY_MESSAGE.find(([header]) => message.startsWith(header))?.[1]
}
