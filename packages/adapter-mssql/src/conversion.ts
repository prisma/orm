import {
  ArgType,
  ColumnType,
  ColumnTypeEnum,
  DriverAdapterError,
  IsolationLevel,
  ResultValue,
} from '@prisma/driver-adapter-utils'
import sql from 'mssql'

export function mapColumnType(col: sql.IColumn): ColumnType {
  switch (col.type) {
    case sql.VarChar:
    case sql.Char:
    case sql.NVarChar:
    case sql.NChar:
    case sql.Text:
    case sql.NText:
    case sql.Xml:
      return ColumnTypeEnum.Text

    case sql.Bit:
      return ColumnTypeEnum.Boolean

    case sql.TinyInt:
    case sql.SmallInt:
    case sql.Int:
      return ColumnTypeEnum.Int32

    case sql.BigInt:
      return ColumnTypeEnum.Int64

    case sql.DateTime2:
    case sql.SmallDateTime:
    case sql.DateTime:
    case sql.DateTimeOffset:
      return ColumnTypeEnum.DateTime

    case sql.Real:
      return ColumnTypeEnum.Float

    case sql.Float:
    case sql.Money:
    case sql.SmallMoney:
      return ColumnTypeEnum.Double

    case sql.UniqueIdentifier:
      return ColumnTypeEnum.Uuid

    case sql.Decimal:
    case sql.Numeric:
      return ColumnTypeEnum.Numeric

    case sql.Date:
      return ColumnTypeEnum.Date

    case sql.Time:
      return ColumnTypeEnum.Time

    case sql.VarBinary:
    case sql.Binary:
    case sql.Image:
      return ColumnTypeEnum.Bytes

    default:
      throw new DriverAdapterError({
        kind: 'UnsupportedNativeDataType',
        type: col['udt']?.name ?? 'N/A',
      })
  }
}

export function mapIsolationLevel(level: IsolationLevel): sql.IIsolationLevel {
  switch (level) {
    case 'READ COMMITTED':
      return sql.ISOLATION_LEVEL.READ_COMMITTED
    case 'READ UNCOMMITTED':
      return sql.ISOLATION_LEVEL.READ_UNCOMMITTED
    case 'REPEATABLE READ':
      return sql.ISOLATION_LEVEL.REPEATABLE_READ
    case 'SERIALIZABLE':
      return sql.ISOLATION_LEVEL.SERIALIZABLE
    case 'SNAPSHOT':
      return sql.ISOLATION_LEVEL.SNAPSHOT
    default:
      throw new DriverAdapterError({
        kind: 'InvalidIsolationLevel',
        level,
      })
  }
}

/**
 * Whether a number must be bound as FLOAT explicitly. mssql infers BIGINT for integer-valued numbers
 * outside the INT range, which rejects floats such as 1e20.
 */
export function isFloatArg(arg: unknown, argType: ArgType): arg is number {
  return typeof arg === 'number' && (argType.dbType === 'FLOAT' || argType.dbType === 'REAL')
}

export function mapArg<A>(arg: A | BigInt | Date, argType: ArgType): null | number | BigInt | string | Buffer | A {
  if (arg === null) {
    return null
  }

  if (typeof arg === 'string' && argType.scalarType === 'bigint') {
    arg = BigInt(arg)
  }

  if (typeof arg === 'bigint') {
    if (arg >= BigInt(Number.MIN_SAFE_INTEGER) && arg <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(arg)
    }
    return arg.toString()
  }

  if (typeof arg === 'string' && argType.scalarType === 'datetime') {
    arg = new Date(arg)
  }

  if (arg instanceof Date) {
    switch (argType.dbType) {
      case 'TIME':
        return formatTime(arg)
      case 'DATE':
        return formatDate(arg)
      default:
        return formatDateTime(arg)
    }
  }

  if (typeof arg === 'string' && argType.scalarType === 'bytes') {
    return Buffer.from(arg, 'base64')
  }

  if (ArrayBuffer.isView(arg)) {
    return Buffer.from(arg.buffer, arg.byteOffset, arg.byteLength)
  }

  return arg
}

export function mapRow<A>(row: A[], columns?: sql.IColumn[]): (A | ResultValue)[] {
  return row.map((value, i) => {
    const type = columns?.[i]?.type
    if (value instanceof Date) {
      if (type === sql.Time) {
        return value.toISOString().split('T')[1].replace('Z', '')
      }
      return value.toISOString()
    }

    if (typeof value === 'number' && type === sql.Real) {
      // The driver can return float values as doubles that are equal to the original
      // values when compared with 32-bit precision, but not when 64-bit precision is
      // used. This leads to comparisons failures with the original value in JavaScript.
      // We attempt to represent the number accurately as a double by finding a
      // number with up to 9 decimal places that is equal to the original value.
      for (let digits = 7; digits <= 9; digits++) {
        const parsed = Number.parseFloat(value.toPrecision(digits))
        if (value === new Float32Array([parsed])[0]) {
          return parsed
        }
      }
      // If no suitable precision is found, return the value as is.
      return value
    }

    // Using lower case to make it consistent with the driver in prisma-engines.
    if (typeof value === 'string' && type === sql.UniqueIdentifier) {
      return value.toLowerCase()
    }

    if (typeof value === 'boolean' && type === sql.Bit) {
      return value ? 1 : 0
    }

    return value
  })
}

function formatDateTime(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  const ms = date.getUTCMilliseconds()
  return (
    pad(date.getUTCFullYear(), 4) +
    '-' +
    pad(date.getUTCMonth() + 1) +
    '-' +
    pad(date.getUTCDate()) +
    ' ' +
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds()) +
    (ms ? '.' + String(ms).padStart(3, '0') : '')
  )
}

function formatDate(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  return pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate())
}

function formatTime(date: Date): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, '0')
  const ms = date.getUTCMilliseconds()
  return (
    pad(date.getUTCHours()) +
    ':' +
    pad(date.getUTCMinutes()) +
    ':' +
    pad(date.getUTCSeconds()) +
    (ms ? '.' + String(ms).padStart(3, '0') : '')
  )
}
