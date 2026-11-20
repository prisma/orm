import { Decimal } from '@prisma/client-runtime-utils'
import type { QueryIntrospectionBuiltinType } from '@prisma/generator'

export type RawResponse = {
  columns: string[]
  types: QueryIntrospectionBuiltinType[]
  rows: unknown[][]
}

function deserializeValue(type: QueryIntrospectionBuiltinType, value: unknown): unknown {
  if (value === null) {
    return value
  }

  switch (type) {
    case 'bigint':
      return BigInt(value as string)

    case 'bytes':
      // copy instead of returning a view into Node's shared Buffer pool
      return new Uint8Array(Buffer.from(value as string, 'base64'))

    case 'decimal':
      return new Decimal(value as string)

    case 'datetime':
    case 'date':
      return new Date(value as string)

    case 'time':
      return new Date(`1970-01-01T${value}Z`)

    case 'bigint-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('bigint', v))
    case 'bytes-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('bytes', v))
    case 'decimal-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('decimal', v))
    case 'datetime-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('datetime', v))
    case 'date-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('date', v))
    case 'time-array':
      return (value as unknown[]).map((v: unknown) => deserializeValue('time', v))

    default:
      return value
  }
}

type DeserializedResponse = Array<Record<string, unknown>>

export function deserializeRawResult(response: RawResponse): DeserializedResponse {
  const deserializedResponse: DeserializedResponse = []
  // Performance optimization. See https://github.com/brianc/node-postgres/issues/3042
  const prebuiltEmptyObject = createPrebuiltEmptyResultObject(response)

  for (let i = 0; i < response.rows.length; i++) {
    const row = response.rows[i]
    const mappedRow = { ...prebuiltEmptyObject } as Record<string, unknown>

    for (let j = 0; j < row.length; j++) {
      mappedRow[response.columns[j]] = deserializeValue(response.types[j], row[j])
    }

    deserializedResponse.push(mappedRow)
  }

  return deserializedResponse
}

function createPrebuiltEmptyResultObject(response: RawResponse): Record<string, null> {
  const row = {}

  for (let i = 0; i < response.columns.length; i++) {
    row[response.columns[i]] = null
  }

  return row
}
