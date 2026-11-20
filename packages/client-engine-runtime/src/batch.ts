import { deserializeJsonObject } from './json-protocol'
import { QueryPlanNode } from './query-plan'
import { UserFacingError } from './user-facing-error'
import { doKeysMatch } from './utils'

export type BatchResponse = MultiBatchResponse | CompactedBatchResponse

export type MultiBatchResponse = {
  type: 'multi'
  plans: QueryPlanNode[]
}

export type CompactedBatchResponse = {
  type: 'compacted'
  plan: QueryPlanNode
  arguments: Record<string, {}>[]
  nestedSelection: string[]
  keys: string[]
  expectNonEmpty: boolean
}

/**
 * Checks if a value is a placeholder.
 * Handles both formats: `{ $type: 'Param', value: { name: '...' } }` and `{ prisma__type: 'param', prisma__value: { name: '...' } }`
 */
function isPlaceholder(
  value: unknown,
): value is { $type: 'Param'; value: { name: string } } | { prisma__type: 'param'; prisma__value: { name: string } } {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const obj = value as Record<string, unknown>
  if ('$type' in obj && obj.$type === 'Param') {
    return true
  }
  if ('prisma__type' in obj && obj.prisma__type === 'param') {
    return true
  }
  return false
}

function getPlaceholderName(
  value: { $type: 'Param'; value: { name: string } } | { prisma__type: 'param'; prisma__value: { name: string } },
): string | undefined {
  if ('prisma__type' in value) {
    return value.prisma__value?.name
  }
  return (value as { value: { name: string } }).value.name
}

function resolveArgPlaceholders(
  args: Record<string, {}>,
  placeholderValues: Record<string, unknown>,
): Record<string, {}> {
  const resolved: Record<string, {}> = {}
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = value
    if (isPlaceholder(value)) {
      const placeholderName = getPlaceholderName(value)
      if (placeholderName && placeholderName in placeholderValues) {
        resolved[key] = placeholderValues[placeholderName] as {}
      }
    }
  }
  return resolved
}

/**
 * Converts the result of a compacted query back to result objects analogous to what queries
 * would return when executed individually.
 */
export function convertCompactedRows(
  rows: {}[],
  compiledBatch: CompactedBatchResponse,
  placeholderValues: Record<string, unknown> = {},
): unknown[] {
  // a list of objects that contain the keys of every row
  const keysPerRow = rows.map((item) =>
    compiledBatch.keys.reduce((acc, key) => {
      acc[key] = deserializeJsonObject(item[key])
      return acc
    }, {}),
  )

  // the selections inferred from the request, used to filter unwanted columns from the results
  const selection = new Set(compiledBatch.nestedSelection)

  return compiledBatch.arguments.map((args) => {
    const resolvedArgs = resolveArgPlaceholders(args, placeholderValues)

    // we find the index of the row that matches the input arguments - this is the row we want
    // to return minus any extra columns not present in the selection
    const rowIndex = keysPerRow.findIndex((rowKeys) => doKeysMatch(rowKeys, resolvedArgs))
    if (rowIndex === -1) {
      if (compiledBatch.expectNonEmpty) {
        return new UserFacingError(
          'An operation failed because it depends on one or more records that were required but not found',
          'P2025',
        )
      } else {
        return null
      }
    } else {
      const selected = Object.entries(rows[rowIndex]).filter(([k]) => selection.has(k))
      return Object.fromEntries(selected)
    }
  })
}
