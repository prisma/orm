import { Error as DriverAdapterErrorObject } from '@prisma/driver-adapter-utils'

export function convertDriverError(error: unknown): DriverAdapterErrorObject {
  if (isDriverError(error)) {
    return {
      originalMessage: error.message,
      ...mapDriverError(error),
    }
  }

  throw error
}

// When we receive the result, we only get the error message, not the error code.
// Example:
// "name":"Error","message":"D1_ERROR: UNIQUE constraint failed: User.email"
// So we try to match some errors and use the generic error code as a fallback.
// https://www.sqlite.org/rescode.html
export function mapDriverError(error: DriverError): DriverAdapterErrorObject {
  let stripped = error.message.split('D1_ERROR: ').at(1) ?? error.message
  stripped = stripped.split('SqliteError: ').at(1) ?? stripped

  if (stripped.startsWith('UNIQUE constraint failed') || stripped.startsWith('PRIMARY KEY constraint failed')) {
    const rawFields = stripped.split(': ').at(1)?.split(', ')
    const fields = rawFields?.map((field) => field.split('.').pop()!)
    // D1 reports fields as `TableName.column`, so we can recover the table
    // name from the part of the first field before the last `.`.
    const table = rawFields?.at(0)?.split('.').slice(0, -1).join('.')
    return {
      kind: 'UniqueConstraintViolation',
      constraint: fields !== undefined ? { fields } : undefined,
      table: table || undefined,
    }
  } else if (stripped.startsWith('NOT NULL constraint failed')) {
    const fields = stripped
      .split(': ')
      .at(1)
      ?.split(', ')
      .map((field) => field.split('.').pop()!)
    return {
      kind: 'NullConstraintViolation',
      constraint: fields !== undefined ? { fields } : undefined,
    }
  } else if (stripped.startsWith('FOREIGN KEY constraint failed') || stripped.startsWith('CHECK constraint failed')) {
    return {
      kind: 'ForeignKeyConstraintViolation',
      constraint: { foreignKey: {} },
    }
  } else if (stripped.startsWith('no such table')) {
    return {
      kind: 'TableDoesNotExist',
      table: stripped.split(': ').at(1),
    }
  } else if (stripped.startsWith('no such column')) {
    return {
      kind: 'ColumnNotFound',
      column: stripped.split(': ').at(1),
    }
  } else if (stripped.includes('has no column named ')) {
    return {
      kind: 'ColumnNotFound',
      column: stripped.split('has no column named ').at(1),
    }
  }

  return {
    kind: 'sqlite',
    extendedCode: error['code'] ?? error['cause']?.['code'] ?? 1,
    message: error.message,
  }
}

type DriverError = {
  message: string
}

function isDriverError(error: any): error is DriverError {
  return typeof error['message'] === 'string'
}
