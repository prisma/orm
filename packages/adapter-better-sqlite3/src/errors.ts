import { Error as DriverAdapterErrorObject } from '@prisma/driver-adapter-utils'

const SQLITE_BUSY = 5
const PRIMARY_ERROR_CODE_MASK = 0xff
const UNKNOWN_ERROR_CODE_PREFIX = 'UNKNOWN_SQLITE_ERROR_'

export function convertDriverError(error: unknown): DriverAdapterErrorObject {
  if (isDriverError(error)) {
    return {
      originalCode: error.code,
      originalMessage: error.message,
      ...mapDriverError(error),
    }
  }

  throw error
}

function mapDriverError(error: DriverError): DriverAdapterErrorObject {
  switch (error.code) {
    case 'SQLITE_CONSTRAINT_UNIQUE':
    case 'SQLITE_CONSTRAINT_PRIMARYKEY': {
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
    case 'SQLITE_CONSTRAINT_NOTNULL': {
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
    case 'SQLITE_CONSTRAINT_FOREIGNKEY':
    case 'SQLITE_CONSTRAINT_TRIGGER':
      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint: { foreignKey: {} },
      }
    default: {
      const extendedCode = extendedCodeFromName(error.code)

      // Lock contention is reported through a family of extended result codes
      // (`SQLITE_BUSY_RECOVERY`, `SQLITE_BUSY_SNAPSHOT`, ...) that all mean the
      // same thing to the caller, so they are matched on the primary code, like
      // the libsql adapter does by masking the extended code.
      if (
        error.code.startsWith('SQLITE_BUSY') ||
        (extendedCode !== undefined && (extendedCode & PRIMARY_ERROR_CODE_MASK) === SQLITE_BUSY)
      ) {
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
        // Falling back to the generic code, like the d1 adapter does when the
        // driver gives it none.
        extendedCode: extendedCode ?? 1,
        message: error.message,
      }
    }
  }
}

/**
 * better-sqlite3 identifies result codes by name and has no numeric field for
 * them, but codes missing from its name table are reported as
 * `UNKNOWN_SQLITE_ERROR_<code>`, which is the only place the number survives.
 */
function extendedCodeFromName(code: string): number | undefined {
  if (!code.startsWith(UNKNOWN_ERROR_CODE_PREFIX)) {
    return undefined
  }
  const extendedCode = Number(code.slice(UNKNOWN_ERROR_CODE_PREFIX.length))
  return Number.isInteger(extendedCode) ? extendedCode : undefined
}

type DriverError = {
  code: string
  message: string
}

function isDriverError(error: any): error is DriverError {
  return typeof error.code === 'string' && typeof error.message === 'string'
}
