import { Error as DriverAdapterErrorObject, MappedError } from '@prisma/driver-adapter-utils'
import { DatabaseError } from '@prisma/ppg'

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

function mapDriverError(error: DatabaseError): MappedError {
  switch (error.code) {
    case '22001':
      return {
        kind: 'LengthMismatch',
        column: error.details.column,
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
      let constraint: { fields: string[] } | { index: string } | undefined

      if (error.details.constraint) {
        constraint = { index: error.details.constraint }
      } else {
        const fields = error.details.detail
          ?.match(/Key \(([^)]+)\)/)
          ?.at(1)
          ?.split(', ')
        if (fields !== undefined) {
          constraint = { fields }
        }
      }

      return {
        kind: 'UniqueConstraintViolation',
        constraint,
      }
    }
    case '23502': {
      const fields = error.details.detail
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

      if (error.details.column) {
        constraint = { fields: [error.details.column] }
      } else if (error.details.constraint) {
        constraint = { index: error.details.constraint }
      }

      return {
        kind: 'ForeignKeyConstraintViolation',
        constraint,
      }
    }
    case '23001': {
      let constraint: { fields: string[] } | { index: string } | undefined

      if (error.details.column) {
        constraint = { fields: [error.details.column] }
      } else if (error.details.constraint) {
        constraint = { index: error.details.constraint }
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
        severity: error.details.severity ?? 'N/A',
        message: error.message,
        detail: error.details.detail,
        column: error.details.column,
        hint: error.details.hint,
      }
  }
}

function isDriverError(error: any): error is DatabaseError {
  return (
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    typeof error.details === 'object' &&
    typeof error.details.severity === 'string' &&
    (typeof error.details.detail === 'string' || error.details.detail === undefined) &&
    (typeof error.details.column === 'string' || error.details.column === undefined) &&
    (typeof error.details.hint === 'string' || error.details.hint === undefined)
  )
}
