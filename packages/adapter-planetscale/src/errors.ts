import { Error as DriverAdapterErrorObject, MappedError } from '@prisma/driver-adapter-utils'

import { ParsedDatabaseError } from './planetscale'

export function convertDriverError(error: ParsedDatabaseError): DriverAdapterErrorObject {
  return {
    originalCode: `${error.code}`,
    originalMessage: error.message,
    ...mapDriverError(error),
  }
}

export function mapDriverError(error: ParsedDatabaseError): MappedError {
  switch (error.code) {
    case 1062: {
      const rawKey = error.message.split(' ').pop()?.split("'").at(1)
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
      const field = error.message.split(' ').at(17)?.split('`').at(1)
      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint: field !== undefined ? { fields: [field] } : undefined,
      }
    }

    case 1263: {
      const index = error.message.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'NullConstraintViolation',
        constraint: index !== undefined ? { index } : undefined,
      }
    }

    case 1264:
      return {
        kind: 'ValueOutOfRange',
        cause: error.message,
      }

    case 1364:
    case 1048: {
      const field = error.message.split(' ').at(1)?.split("'").at(1)
      return {
        kind: 'NullConstraintViolation',
        constraint: field !== undefined ? { fields: [field] } : undefined,
      }
    }

    case 1049: {
      const db = error.message.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'DatabaseDoesNotExist',
        db,
      }
    }

    case 1007: {
      const db = error.message.split(' ').at(3)?.split("'").at(1)
      return {
        kind: 'DatabaseAlreadyExists',
        db,
      }
    }

    case 1044: {
      const db = error.message.split(' ').pop()?.split("'").at(1)
      return {
        kind: 'DatabaseAccessDenied',
        db,
      }
    }

    case 1045: {
      const user = error.message.split(' ').at(4)?.split('@').at(0)?.split("'").at(1)
      return {
        kind: 'AuthenticationFailed',
        user,
      }
    }

    case 1146: {
      const table = error.message.split(' ').at(1)?.split("'").at(1)?.split('.').pop()
      return {
        kind: 'TableDoesNotExist',
        table,
      }
    }

    case 1054: {
      const column = error.message.split(' ').at(2)?.split("'").at(1)
      return {
        kind: 'ColumnNotFound',
        column,
      }
    }

    case 1406: {
      const column = error.message
        .split(' ')
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
        cause: error.message,
      }

    default:
      return {
        kind: 'mysql',
        code: error.code,
        message: error.message,
        state: error.state,
      }
  }
}
