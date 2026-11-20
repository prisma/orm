import { Decimal } from '@prisma/client-runtime-utils'

import { FieldScalarType, FieldType, ResultNode } from '../query-plan'
import { UserFacingError } from '../user-facing-error'
import { assertNever, isDate, isUint8Array, safeJsonStringify } from '../utils'
import { PrismaObject, Value } from './scope'

export class DataMapperError extends UserFacingError {
  name = 'DataMapperError'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'P2023', options)
  }
}

// Optimization: Cache field entries to avoid repeated Object.entries() allocations per row
const fieldEntriesCache = new WeakMap<Record<string, ResultNode>, [string, ResultNode][]>()

function getFieldEntries(fields: Record<string, ResultNode>): [string, ResultNode][] {
  let entries = fieldEntriesCache.get(fields)
  if (!entries) {
    entries = Object.entries(fields)
    fieldEntriesCache.set(fields, entries)
  }
  return entries
}

export function applyDataMap(data: Value, structure: ResultNode, enums: Record<string, Record<string, string>>): Value {
  switch (structure.type) {
    case 'affectedRows':
      if (typeof data !== 'number') {
        throw new DataMapperError(`Expected an affected rows count, got: ${typeof data} (${data})`)
      }
      return { count: data }

    case 'object':
      return mapArrayOrObject(data, structure.fields, enums, structure.skipNulls)

    case 'field':
      return mapValue(data, '<result>', structure.fieldType, enums)

    default:
      assertNever(structure, `Invalid data mapping type: '${(structure as ResultNode).type}'`)
  }
}

function mapArrayOrObject(
  data: Value,
  fields: Record<string, ResultNode>,
  enums: Record<string, Record<string, string>>,
  skipNulls?: boolean,
): PrismaObject | PrismaObject[] | null {
  if (data === null) return null

  if (Array.isArray(data)) {
    let rows = data as PrismaObject[]
    if (skipNulls) {
      rows = rows.filter((row) => row !== null)
    }
    return rows.map((row) => mapObject(row, fields, enums))
  }

  if (typeof data === 'object') {
    const row = data as PrismaObject
    return mapObject(row, fields, enums)
  }

  if (typeof data === 'string') {
    let decodedData: Value
    try {
      decodedData = JSON.parse(data)
    } catch (error) {
      throw new DataMapperError(`Expected an array or object, got a string that is not valid JSON`, {
        cause: error,
      })
    }
    return mapArrayOrObject(decodedData, fields, enums, skipNulls)
  }

  throw new DataMapperError(`Expected an array or an object, got: ${typeof data}`)
}

// Recursive
function mapObject(
  data: PrismaObject,
  fields: Record<string, ResultNode>,
  enums: Record<string, Record<string, string>>,
): PrismaObject {
  if (typeof data !== 'object') {
    throw new DataMapperError(`Expected an object, but got '${typeof data}'`)
  }

  const result = {}
  for (const [name, node] of getFieldEntries(fields)) {
    switch (node.type) {
      case 'affectedRows': {
        throw new DataMapperError(`Unexpected 'AffectedRows' node in data mapping for field '${name}'`)
      }

      case 'object': {
        const { serializedName, fields: nodeFields, skipNulls } = node
        if (serializedName !== null && !Object.hasOwn(data, serializedName)) {
          throw new DataMapperError(
            `Missing data field (Object): '${name}'; ` + `node: ${JSON.stringify(node)}; data: ${JSON.stringify(data)}`,
          )
        }

        const target = serializedName !== null ? data[serializedName] : data
        result[name] = mapArrayOrObject(target, nodeFields, enums, skipNulls)
        break
      }

      case 'field':
        {
          const dbName = node.dbName
          if (Object.hasOwn(data, dbName)) {
            result[name] = mapField(data[dbName], dbName, node.fieldType, enums)
          } else {
            throw new DataMapperError(
              `Missing data field (Value): '${dbName}'; ` +
                `node: ${JSON.stringify(node)}; data: ${JSON.stringify(data)}`,
            )
          }
        }
        break

      default:
        assertNever(node, `DataMapper: Invalid data mapping node type: '${(node as ResultNode).type}'`)
    }
  }
  return result
}

function mapField(
  value: unknown,
  columnName: string,
  fieldType: FieldType,
  enums: Record<string, Record<string, string>>,
): unknown {
  if (value === null) {
    return fieldType.arity === 'list' ? [] : null
  }

  if (fieldType.arity === 'list') {
    const values = value as unknown[]
    return values.map((v, i) => mapValue(v, `${columnName}[${i}]`, fieldType, enums))
  }

  return mapValue(value, columnName, fieldType, enums)
}

function mapValue(
  value: unknown,
  columnName: string,
  scalarType: FieldScalarType,
  enums: Record<string, Record<string, string>>,
): unknown {
  switch (scalarType.type) {
    case 'unsupported':
      return value

    case 'string': {
      if (typeof value !== 'string') {
        throw new DataMapperError(`Expected a string in column '${columnName}', got ${typeof value}: ${value}`)
      }
      return value
    }

    case 'int': {
      switch (typeof value) {
        case 'number': {
          return Math.trunc(value)
        }

        case 'string': {
          const numberValue = Math.trunc(Number(value))
          if (Number.isNaN(numberValue) || !Number.isFinite(numberValue)) {
            throw new DataMapperError(`Expected an integer in column '${columnName}', got string: ${value}`)
          }
          if (!Number.isSafeInteger(numberValue)) {
            throw new DataMapperError(
              `Integer value in column '${columnName}' is too large to represent as a JavaScript number without loss of precision, got: ${value}. Consider using BigInt type.`,
            )
          }
          return numberValue
        }

        default:
          throw new DataMapperError(`Expected an integer in column '${columnName}', got ${typeof value}: ${value}`)
      }
    }

    case 'bigint': {
      if (typeof value !== 'number' && typeof value !== 'string') {
        throw new DataMapperError(`Expected a bigint in column '${columnName}', got ${typeof value}: ${value}`)
      }
      return { $type: 'BigInt', value }
    }

    case 'float': {
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsedValue = Number(value)
        if (Number.isNaN(parsedValue) && !/^[-+]?nan$/.test(value.toLowerCase())) {
          throw new DataMapperError(`Expected a float in column '${columnName}', got string: ${value}`)
        }
        return parsedValue
      }
      throw new DataMapperError(`Expected a float in column '${columnName}', got ${typeof value}: ${value}`)
    }

    case 'boolean': {
      if (typeof value === 'boolean') return value
      if (typeof value === 'number') return value === 1
      if (typeof value === 'string') {
        if (value === 'true' || value === 'TRUE' || value === '1') {
          return true
        } else if (value === 'false' || value === 'FALSE' || value === '0') {
          return false
        } else {
          throw new DataMapperError(`Expected a boolean in column '${columnName}', got ${typeof value}: ${value}`)
        }
      }
      if (Array.isArray(value) || isUint8Array(value)) {
        for (const byte of value) {
          if (byte !== 0) return true
        }
        return false
      }
      throw new DataMapperError(`Expected a boolean in column '${columnName}', got ${typeof value}: ${value}`)
    }

    case 'decimal':
      if (typeof value !== 'number' && typeof value !== 'string' && !Decimal.isDecimal(value)) {
        throw new DataMapperError(`Expected a decimal in column '${columnName}', got ${typeof value}: ${value}`)
      }
      return { $type: 'Decimal', value }

    case 'datetime': {
      if (typeof value === 'string') {
        return { $type: 'DateTime', value: normalizeDateTime(value) }
      }
      if (typeof value === 'number' || isDate(value)) {
        return { $type: 'DateTime', value }
      }
      throw new DataMapperError(`Expected a date in column '${columnName}', got ${typeof value}: ${value}`)
    }

    case 'object': {
      return { $type: 'Json', value: safeJsonStringify(value) }
    }

    case 'json': {
      // The value received here should normally be a string, but we cannot guarantee that,
      // because of SQLite databases like D1, which can return JSON scalars directly. We therefore
      // convert the value we receive to a string.
      return { $type: 'Json', value: `${value}` }
    }

    case 'bytes': {
      switch (scalarType.encoding) {
        case 'base64':
          if (typeof value !== 'string') {
            throw new DataMapperError(
              `Expected a base64-encoded byte array in column '${columnName}', got ${typeof value}: ${value}`,
            )
          }
          return { $type: 'Bytes', value }

        case 'hex':
          if (typeof value !== 'string' || !value.startsWith('\\x')) {
            throw new DataMapperError(
              `Expected a hex-encoded byte array in column '${columnName}', got ${typeof value}: ${value}`,
            )
          }
          return { $type: 'Bytes', value: Buffer.from(value.slice(2), 'hex').toString('base64') }

        case 'array':
          if (Array.isArray(value)) {
            return { $type: 'Bytes', value: Buffer.from(value).toString('base64') }
          }
          if (isUint8Array(value)) {
            return { $type: 'Bytes', value: Buffer.from(value).toString('base64') }
          }
          throw new DataMapperError(`Expected a byte array in column '${columnName}', got ${typeof value}: ${value}`)

        default:
          assertNever(scalarType.encoding, `DataMapper: Unknown bytes encoding: ${scalarType.encoding}`)
      }
      break
    }

    case 'enum': {
      const enumDef = enums[scalarType.name]
      if (enumDef === undefined) {
        throw new DataMapperError(`Unknown enum '${scalarType.name}'`)
      }
      const enumValue = enumDef[`${value}`]
      if (enumValue === undefined) {
        throw new DataMapperError(`Value '${value}' not found in enum '${scalarType.name}'`)
      }
      return enumValue
    }

    default:
      assertNever(scalarType, `DataMapper: Unknown result type: ${scalarType['type']}`)
  }
}

/**
 * A regular expression that matches a time string with an optional timezone.
 * It matches formats like:
 * - `12:34:56`
 * - `12:34:56.789`
 * - `12:34:56Z`
 * - `12:34:56+02`
 * - `12:34:56-02:30`
 */
const TIME_TZ_PATTERN = /\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/

/**
 * Normalizes date time strings received from driver adapters. The returned string is always a
 * valid input for the Javascript `Date` constructor. This function will add a UTC timezone suffix
 * if there's no timezone specified, to prevent it from being interpreted as local time.
 */
function normalizeDateTime(dt: string): string {
  const timeTzMatches = TIME_TZ_PATTERN.exec(dt)
  if (timeTzMatches === null) {
    // We found no time part, so we return it as a plain zulu date,
    // e.g. '2023-10-01T00:00Z'.
    // We append the time because the JS Date constructor can't parse
    // pre-1000 dates with a timezone, for example '0032-01-01Z' parses
    // as '2032-01-01T00:00:00.000Z'.
    return `${dt}T00:00:00Z`
  }

  let dtWithTz = dt
  const [timeTz, tz, tzMinuteOffset] = timeTzMatches
  if (tz !== undefined && tz !== 'Z' && tzMinuteOffset === undefined) {
    // If the timezone is specified as +HH or -HH (without minutes),
    // we need to suffix it with ':00' to make it a valid Date input.
    dtWithTz = `${dt}:00`
  } else if (tz === undefined) {
    // If the timezone is not specified at all, we suffix it with 'Z'.
    dtWithTz = `${dt}Z`
  }

  if (timeTz.length === dt.length) {
    // If the entire datetime was just the time, we prepend the unix epoch date.
    return `1970-01-01T${dtWithTz}`
  }

  const timeSeparatorIndex = timeTzMatches.index - 1
  // If the time part is preceded by a space, we replace it with 'T'.
  if (dtWithTz[timeSeparatorIndex] === ' ') {
    dtWithTz = `${dtWithTz.slice(0, timeSeparatorIndex)}T${dtWithTz.slice(timeSeparatorIndex + 1)}`
  }

  return dtWithTz
}
