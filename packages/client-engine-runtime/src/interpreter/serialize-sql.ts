import { type ColumnType, ColumnTypeEnum, type SqlResultSet } from '@prisma/driver-adapter-utils'

import { assertNever } from '../utils'

export function serializeSql(resultSet: SqlResultSet): Record<string, unknown>[] {
  return resultSet.rows.map((row) =>
    row.reduce<Record<string, unknown>>((acc, value, index) => {
      acc[resultSet.columnNames[index]] = value
      return acc
    }, {}),
  )
}

export function serializeRawSql(resultSet: SqlResultSet): Record<string, unknown> {
  return {
    columns: resultSet.columnNames,
    types: resultSet.columnTypes.map((type) => serializeColumnType(type)),
    rows: resultSet.rows.map((row) =>
      row.map((value, index) => serializeRawValue(value, resultSet.columnTypes[index])),
    ),
  }
}

function serializeRawValue(value: unknown, type: ColumnType): unknown {
  if (value === null) {
    return null
  }

  switch (type) {
    case ColumnTypeEnum.Int32:
      switch (typeof value) {
        case 'number':
          return Math.trunc(value)
        case 'string':
          return Math.trunc(Number(value))
        default:
          throw new Error(`Cannot serialize value of type ${typeof value} as Int32`)
      }

    case ColumnTypeEnum.Int32Array:
      if (!Array.isArray(value)) {
        throw new Error(`Cannot serialize value of type ${typeof value} as Int32Array`)
      }
      return value.map((v) => serializeRawValue(v, ColumnTypeEnum.Int32))

    case ColumnTypeEnum.Int64:
      switch (typeof value) {
        case 'number':
          return BigInt(Math.trunc(value))
        case 'string':
          return value
        default:
          throw new Error(`Cannot serialize value of type ${typeof value} as Int64`)
      }

    case ColumnTypeEnum.Int64Array:
      if (!Array.isArray(value)) {
        throw new Error(`Cannot serialize value of type ${typeof value} as Int64Array`)
      }
      return value.map((v) => serializeRawValue(v, ColumnTypeEnum.Int64))

    case ColumnTypeEnum.Json:
      switch (typeof value) {
        case 'string':
          return JSON.parse(value)
        default:
          throw new Error(`Cannot serialize value of type ${typeof value} as Json`)
      }

    case ColumnTypeEnum.JsonArray:
      if (!Array.isArray(value)) {
        throw new Error(`Cannot serialize value of type ${typeof value} as JsonArray`)
      }
      return value.map((v) => serializeRawValue(v, ColumnTypeEnum.Json))

    case ColumnTypeEnum.Boolean:
      switch (typeof value) {
        case 'boolean':
          return value
        case 'string':
          return value === 'true' || value === '1'
        case 'number':
          return value === 1
        default:
          throw new Error(`Cannot serialize value of type ${typeof value} as Boolean`)
      }

    case ColumnTypeEnum.BooleanArray:
      if (!Array.isArray(value)) {
        throw new Error(`Cannot serialize value of type ${typeof value} as BooleanArray`)
      }
      return value.map((v) => serializeRawValue(v, ColumnTypeEnum.Boolean))

    default:
      return value // For all other types, return the value as is
  }
}

// maps JS column types to their Rust equivalents
function serializeColumnType(columnType: ColumnType): string {
  switch (columnType) {
    case ColumnTypeEnum.Int32:
      return 'int'
    case ColumnTypeEnum.Int64:
      return 'bigint'
    case ColumnTypeEnum.Float:
      return 'float'
    case ColumnTypeEnum.Double:
      return 'double'
    case ColumnTypeEnum.Text:
      return 'string'
    case ColumnTypeEnum.Enum:
      return 'enum'
    case ColumnTypeEnum.Bytes:
      return 'bytes'
    case ColumnTypeEnum.Boolean:
      return 'bool'
    case ColumnTypeEnum.Character:
      return 'char'
    case ColumnTypeEnum.Numeric:
      return 'decimal'
    case ColumnTypeEnum.Json:
      return 'json'
    case ColumnTypeEnum.Uuid:
      return 'uuid'
    case ColumnTypeEnum.DateTime:
      return 'datetime'
    case ColumnTypeEnum.Date:
      return 'date'
    case ColumnTypeEnum.Time:
      return 'time'
    case ColumnTypeEnum.Int32Array:
      return 'int-array'
    case ColumnTypeEnum.Int64Array:
      return 'bigint-array'
    case ColumnTypeEnum.FloatArray:
      return 'float-array'
    case ColumnTypeEnum.DoubleArray:
      return 'double-array'
    case ColumnTypeEnum.TextArray:
      return 'string-array'
    case ColumnTypeEnum.EnumArray:
      return 'string-array'
    case ColumnTypeEnum.BytesArray:
      return 'bytes-array'
    case ColumnTypeEnum.BooleanArray:
      return 'bool-array'
    case ColumnTypeEnum.CharacterArray:
      return 'char-array'
    case ColumnTypeEnum.NumericArray:
      return 'decimal-array'
    case ColumnTypeEnum.JsonArray:
      return 'json-array'
    case ColumnTypeEnum.UuidArray:
      return 'uuid-array'
    case ColumnTypeEnum.DateTimeArray:
      return 'datetime-array'
    case ColumnTypeEnum.DateArray:
      return 'date-array'
    case ColumnTypeEnum.TimeArray:
      return 'time-array'
    case ColumnTypeEnum.UnknownNumber:
      return 'unknown'
    /// The following PlanetScale type IDs are mapped into Set:
    /// - SET (SET) -> e.g. `"foo,bar"` (String-encoded, comma-separated)
    case ColumnTypeEnum.Set:
      return 'string'
    default:
      assertNever(columnType, `Unexpected column type: ${columnType}`)
  }
}
