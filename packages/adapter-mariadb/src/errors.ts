import { Error as DriverAdapterErrorObject, MappedError } from '@prisma/driver-adapter-utils'
import type { SqlError } from 'mariadb'

export function convertDriverError(error: unknown): DriverAdapterErrorObject {
  if (isDriverError(error)) {
    return {
      originalCode: error.errno.toString(),
      originalMessage: error.sqlMessage ?? 'N/A',
      ...mapDriverError(error),
    }
  }

  throw error
}

export function mapDriverError(error: DriverError): MappedError {
  switch (error.errno) {
    case 1062: {
      const rawKey = error.sqlMessage?.split(' ').pop()?.split("'").at(1)
      const keyParts = rawKey?.split('.')
      const table = keyParts && keyParts.length > 1 ? keyParts.slice(0, -1).join('.') : undefined
      const index = keyParts?.at(-1)
      return {
        kind: 'UniqueConstraintViolation',
        constraint: index !== undefined ? { index } : undefined,
        table,
      }
    }

    case 1451:
    case 1452: {
      const field = error.sqlMessage?.split(' ').at(17)?.split('`').at(1)
      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint: field !== undefined ? { fields: [field] } : undefined,
      }
    }

    case 1263: {
      const index = error.sqlMessage?.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'NullConstraintViolation',
        constraint: index !== undefined ? { index } : undefined,
      }
    }

    case 1264:
      return {
        kind: 'ValueOutOfRange',
        cause: error.sqlMessage ?? 'N/A',
      }

    case 1364:
    case 1048: {
      const field = error.sqlMessage?.split(' ').at(1)?.split("'").at(1)
      return {
        kind: 'NullConstraintViolation',
        constraint: field !== undefined ? { fields: [field] } : undefined,
      }
    }

    case 1049: {
      const db = error.sqlMessage?.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'DatabaseDoesNotExist',
        db,
      }
    }

    case 1007: {
      const db = error.sqlMessage?.split(' ').at(3)?.split("'").at(1)
      return {
        kind: 'DatabaseAlreadyExists',
        db,
      }
    }

    case 1044: {
      const db = error.sqlMessage?.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'DatabaseAccessDenied',
        db,
      }
    }

    case 1045: {
      const user = error.sqlMessage?.split(' ').at(4)?.split('@').at(0)?.split("'").at(1)
      return {
        kind: 'AuthenticationFailed',
        user,
      }
    }

    case 1146: {
      const table = error.sqlMessage?.split(' ').at(1)?.split("'").at(1)?.split('.').pop()
      return {
        kind: 'TableDoesNotExist',
        table,
      }
    }

    case 1054: {
      const column = error.sqlMessage?.split(' ').at(2)?.split("'").at(1)
      return {
        kind: 'ColumnNotFound',
        column,
      }
    }

    case 1406: {
      const column = error.sqlMessage
        ?.split(' ')
        .flatMap((part) => part.split("'"))
        .at(6)
      return {
        kind: 'LengthMismatch',
        column,
      }
    }

    case 1191:
      return {
        kind: 'MissingFullTextSearchIndex',
      }

    case 1213:
      return {
        kind: 'TransactionWriteConflict',
      }

    case 1040:
    case 1203:
      return {
        kind: 'TooManyConnections',
        cause: error.sqlMessage ?? 'N/A',
      }

    default:
      return {
        kind: 'mysql',
        code: error.errno,
        message: error.sqlMessage ?? 'N/A',
        state: error.sqlState ?? 'N/A',
        cause: error.cause?.message ?? undefined,
      }
  }
}

type DriverError = {
  errno: number
  sqlMessage: string | null
  sqlState: string | null
  cause?: SqlError
}

function isDriverError(error: any): error is DriverError {
  return (
    typeof error.errno === 'number' &&
    (typeof error.sqlMessage === 'string' || error.sqlMessage === null) &&
    (typeof error.sqlState === 'string' || error.sqlState === null)
  )
}
