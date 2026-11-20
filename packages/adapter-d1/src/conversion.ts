import { ArgType, ColumnType, ColumnTypeEnum, ResultValue } from '@prisma/driver-adapter-utils'

export type Value = null | string | number | object

export function getColumnTypes(columnNames: string[], rows: unknown[][]): ColumnType[] {
  const columnTypes: (ColumnType | null)[] = []

  columnLoop: for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex++) {
    // No declared column type in db schema, try inferring it.
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const candidateValue = rows[rowIndex][columnIndex] as Value
      if (candidateValue !== null) {
        const inferred = inferColumnType(candidateValue)
        // JSON values that represent plain numbers are returned as JS numbers by D1.
        // This can cause issues if different rows have differently shaped JSON, leading to
        // different inferred types for the same column. To avoid this, we set the column
        // type to text if any row contains a text value.
        if (columnTypes[columnIndex] === undefined || inferred === ColumnTypeEnum.Text) {
          columnTypes[columnIndex] = inferred
        }
        if (inferred !== ColumnTypeEnum.UnknownNumber) {
          // We can move on to the next column if we found a non-number.
          continue columnLoop
        }
      }
    }

    if (columnTypes[columnIndex] === undefined) {
      // No non-null value found for this column, fall back to int32 to mimic what quaint does
      columnTypes[columnIndex] = ColumnTypeEnum.Int32
    }
  }

  return columnTypes as ColumnType[]
}

/**
 * Default mapping between JS and D1 types.
 * | JavaScript       | D1           |
 * | :--------------: | :---------:  |
 * | null             | NULL         |
 * | Number           | REAL         |
 * | Number¹          | INTEGER      |
 * | null             | TEXT         |
 * | Boolean²         | INTEGER      |
 * | ArrayBuffer      | BLOB         |
 *
 * ¹ - D1 supports 64-bit signed INTEGER values internally, however BigInts are not currently supported in the API yet. JavaScript integers are safe up to Number.MAX_SAFE_INTEGER.
 *
 * ² - Booleans will be cast to an INTEGER type where 1 is TRUE and 0 is FALSE.
 */
function inferColumnType(value: NonNullable<Value>): ColumnType {
  switch (typeof value) {
    case 'string':
      return inferStringType(value)
    case 'number':
      return inferNumberType(value)
    case 'object':
      return inferObjectType(value)
    default:
      throw new UnexpectedTypeError(value)
  }
}

// See https://stackoverflow.com/a/3143231/1345244
const isoDateRegex = new RegExp(
  /^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))$|^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))$|^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))$/,
)

// SQLITE date format, returned by built-in time functions. See https://www.sqlite.org/lang_datefunc.html
// Essentially, it is "<ISO Date> <ISO Time>"
const sqliteDateRegex = /^\d{4}-[0-1]\d-[0-3]\d [0-2]\d:[0-5]\d:[0-5]\d$/
function isISODate(str: string) {
  return isoDateRegex.test(str) || sqliteDateRegex.test(str)
}

function inferStringType(value: string): ColumnType {
  if (isISODate(value)) {
    return ColumnTypeEnum.DateTime
  }

  return ColumnTypeEnum.Text
}

function inferNumberType(_: number): ColumnType {
  return ColumnTypeEnum.UnknownNumber
}

function inferObjectType(value: Object): ColumnType {
  if (value instanceof Array) {
    return ColumnTypeEnum.Bytes
  }
  throw new UnexpectedTypeError(value)
}

class UnexpectedTypeError extends Error {
  name = 'UnexpectedTypeError'
  constructor(value: unknown) {
    const type = typeof value
    const repr = type === 'object' ? JSON.stringify(value) : String(value)
    super(`unexpected value of type ${type}: ${repr}`)
  }
}

export function mapRow<A>(result: (A | ResultValue)[], columnTypes: ColumnType[]): (A | ResultValue)[] {
  for (let i = 0; i < result.length; i++) {
    const value = result[i]

    if (value instanceof ArrayBuffer) {
      result[i] = new Uint8Array(value)
      continue
    }

    if (
      typeof value === 'number' &&
      (columnTypes[i] === ColumnTypeEnum.Int32 || columnTypes[i] === ColumnTypeEnum.Int64) &&
      !Number.isInteger(value)
    ) {
      result[i] = Math.trunc(value)
      continue
    }

    if (typeof value === 'number' && columnTypes[i] === ColumnTypeEnum.Text) {
      result[i] = value.toString()
      continue
    }

    if (typeof value === 'bigint') {
      result[i] = value.toString()
      continue
    }

    if (columnTypes[i] === ColumnTypeEnum.Boolean) {
      result[i] = JSON.parse(value as any)
    }
  }

  return result
}

// Sanitize the query arguments before sending them to the database.
export function mapArg<A>(arg: A | Date, argType: ArgType): null | number | string | number[] | A {
  if (arg === null) {
    return null
  }

  if (typeof arg === 'bigint' || argType.scalarType === 'bigint') {
    const asInt56 = Number.parseInt(`${arg}`)
    if (!Number.isSafeInteger(asInt56)) {
      throw new Error(`Invalid Int64-encoded value received: ${arg}`)
    }

    return asInt56
  }

  if (typeof arg === 'string' && argType.scalarType === 'int') {
    return Number.parseInt(arg)
  }

  if (typeof arg === 'string' && argType.scalarType === 'float') {
    return Number.parseFloat(arg)
  }

  if (typeof arg === 'string' && argType.scalarType === 'decimal') {
    // This can lose precision, but SQLite does not have a native decimal type.
    // This is how we have historically handled it.
    return Number.parseFloat(arg)
  }

  // * Hack for booleans, we must convert them to 0/1.
  // * ✘ [ERROR] Error in performIO: Error: D1_TYPE_ERROR: Type 'boolean' not supported for value 'true'
  if (arg === true) {
    return 1
  }

  if (arg === false) {
    return 0
  }

  if (typeof arg === 'string' && argType.scalarType === 'datetime') {
    arg = new Date(arg)
  }

  if (arg instanceof Date) {
    return arg.toISOString().replace('Z', '+00:00')
  }

  if (typeof arg === 'string' && argType.scalarType === 'bytes') {
    return Array.from(Buffer.from(arg, 'base64'))
  }

  if (arg instanceof Uint8Array) {
    return Array.from(arg)
  }

  return arg
}
