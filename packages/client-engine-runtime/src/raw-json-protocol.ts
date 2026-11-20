import { Decimal } from '@prisma/client-runtime-utils'

export type RawResponse = {
  columns: string[]
  types: string[]
  rows: unknown[][]
}

/*
 * Normalizes responses from the raw JSON protocol to ensure consistency with
 * snapshots in tests. Modifies the response in-place.
 */
export function normalizeRawJsonProtocolResponse(response: RawResponse): RawResponse {
  for (let i = 0; i < response.rows.length; i++) {
    const row = response.rows[i]

    for (let j = 0; j < row.length; j++) {
      row[j] = normalizeValue(response.types[j], row[j])
    }
  }
  return response
}

function normalizeValue(type: string, value: unknown): unknown {
  if (value === null) {
    return value
  }

  switch (type) {
    case 'bigint':
      return String(BigInt(value as string))
    case 'decimal':
      return String(new Decimal(value as string))

    case 'bigint-array':
      return (value as unknown[]).map((v: unknown) => normalizeValue('bigint', v))
    case 'decimal-array':
      return (value as unknown[]).map((v: unknown) => normalizeValue('decimal', v))

    default:
      return value
  }
}
