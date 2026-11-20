import { Decimal } from '@prisma/client-runtime-utils'

import { assertNever } from './utils'

export type DateTaggedValue = { $type: 'DateTime'; value: string }
export type DecimalTaggedValue = { $type: 'Decimal'; value: string }
export type BytesTaggedValue = { $type: 'Bytes'; value: string }
export type BigIntTaggedValue = { $type: 'BigInt'; value: string }
export type FieldRefTaggedValue = { $type: 'FieldRef'; value: { _ref: string } }
export type EnumTaggedValue = { $type: 'Enum'; value: string }
export type JsonTaggedValue = { $type: 'Json'; value: string }
export type RawTaggedValue = { $type: 'Raw'; value: unknown }

export type JsonInputTaggedValue =
  | DateTaggedValue
  | DecimalTaggedValue
  | BytesTaggedValue
  | BigIntTaggedValue
  | FieldRefTaggedValue
  | JsonTaggedValue
  | EnumTaggedValue
  | RawTaggedValue

export type JsonOutputTaggedValue =
  | DateTaggedValue
  | DecimalTaggedValue
  | BytesTaggedValue
  | BigIntTaggedValue
  | JsonTaggedValue

export type JsOutputValue =
  | null
  | string
  | number
  | boolean
  | bigint
  | Uint8Array
  | Date
  | Decimal
  | JsOutputValue[]
  | { [key: string]: JsOutputValue }

export function normalizeJsonProtocolValues(result: unknown): unknown {
  if (result === null) {
    return result
  }

  if (Array.isArray(result)) {
    return result.map(normalizeJsonProtocolValues)
  }

  if (typeof result === 'object') {
    if (isTaggedValue(result)) {
      return normalizeTaggedValue(result)
    }

    if (ArrayBuffer.isView(result)) {
      const buffer = Buffer.from(result.buffer, result.byteOffset, result.byteLength)
      return buffer.toString('base64')
    }

    // avoid mapping class instances
    if (result.constructor !== null && result.constructor.name !== 'Object') {
      return result
    }

    return mapObjectValues(result, normalizeJsonProtocolValues)
  }

  return result
}

function isTaggedValue(value: unknown): value is JsonOutputTaggedValue {
  return value !== null && typeof value == 'object' && typeof value['$type'] === 'string'
}

/**
 * Normalizes the value inside a tagged value to match the snapshots in tests.
 * Sometimes there are multiple equally valid representations of the same value
 * (e.g. a decimal string may contain an arbitrary number of trailing zeros,
 * datetime strings may specify the UTC offset as either '+00:00' or 'Z', etc).
 * Since these differences have no effect on the actual values received from the
 * Prisma Client once the response is deserialized to JavaScript values, we don't
 * spend extra CPU cycles on normalizing them in the data mapper. Instead, we
 * patch and normalize them here to ensure they are consistent with the snapshots
 * in the query engine tests.
 */
function normalizeTaggedValue({
  $type,
  value,
}: JsonInputTaggedValue | JsonOutputTaggedValue): JsonInputTaggedValue | JsonOutputTaggedValue {
  switch ($type) {
    case 'BigInt':
      return { $type, value: String(value) }
    case 'Bytes':
      return { $type, value: Buffer.from(value, 'base64').toString('base64') }
    case 'DateTime':
      return { $type, value: new Date(value).toISOString() }
    case 'Decimal':
      return { $type, value: String(new Decimal(value)) }
    case 'Json':
      return { $type, value: JSON.stringify(JSON.parse(value)) }
    case 'Raw':
      return { $type, value }
    case 'FieldRef':
      return { $type, value }
    case 'Enum':
      return { $type, value }
    default:
      assertNever(value, 'Unknown tagged value')
  }
}

function mapObjectValues<K extends PropertyKey, T, U>(
  object: Record<K, T>,
  mapper: (value: T, key: K) => U,
): Record<K, U> {
  const result = {} as Record<K, U>

  for (const key of Object.keys(object)) {
    result[key] = mapper(object[key] as T, key as K)
  }

  return result
}

export function deserializeJsonObject(result: unknown): unknown {
  if (result === null) {
    return result
  }

  if (Array.isArray(result)) {
    return result.map(deserializeJsonObject)
  }

  if (typeof result === 'object') {
    if (isTaggedValue(result)) {
      return deserializeTaggedValue(result)
    }

    // avoid mapping class instances
    if (result.constructor !== null && result.constructor.name !== 'Object') {
      return result
    }

    return mapObjectValues(result, deserializeJsonObject)
  }

  return result
}

function deserializeTaggedValue({ $type, value }: JsonInputTaggedValue | JsonOutputTaggedValue): JsOutputValue {
  switch ($type) {
    case 'BigInt':
      return BigInt(value)
    case 'Bytes':
      // copy instead of returning a view into Node's shared Buffer pool
      return new Uint8Array(Buffer.from(value, 'base64'))
    case 'DateTime':
      return new Date(value)
    case 'Decimal':
      return new Decimal(value)
    case 'Json':
      return JSON.parse(value)
    case 'Raw':
      return value as JsOutputValue
    case 'FieldRef':
      throw new Error('FieldRef tagged values cannot be deserialized to JavaScript values')
    case 'Enum':
      return value
    default:
      assertNever(value, 'Unknown tagged value')
  }
}
