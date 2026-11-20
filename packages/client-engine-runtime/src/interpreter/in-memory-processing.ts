import { InMemoryOps, Pagination } from '../query-plan'
import { doKeysMatch } from '../utils'

export function processRecords(value: unknown, ops: InMemoryOps): unknown {
  if (value == null) {
    return value
  }

  if (typeof value === 'string') {
    return processRecords(JSON.parse(value), ops)
  }

  if (Array.isArray(value)) {
    return processManyRecords(value as Record<string, unknown>[], ops)
  }

  return processOneRecord(value as Record<string, unknown>, ops)
}

function processOneRecord(record: Record<string, unknown>, ops: InMemoryOps): Record<string, unknown> | null {
  if (ops.pagination) {
    const { skip, take, cursor } = ops.pagination
    if (skip !== null && skip > 0) {
      return null
    }
    if (take === 0) {
      return null
    }
    if (cursor !== null && !doKeysMatch(record, cursor)) {
      return null
    }
  }
  return processNestedRecords(record, ops.nested)
}

function processNestedRecords(
  record: Record<string, unknown>,
  opsMap: Record<string, InMemoryOps>,
): Record<string, unknown> {
  for (const [key, ops] of Object.entries(opsMap)) {
    record[key] = processRecords(record[key], ops)
  }
  return record
}

function processManyRecords(records: Record<string, unknown>[], ops: InMemoryOps): Record<string, unknown>[] {
  if (ops.distinct !== null) {
    const fields = ops.linkingFields !== null ? [...ops.distinct, ...ops.linkingFields] : ops.distinct
    records = distinctBy(records, fields)
  }

  if (ops.pagination) {
    records = paginate(records, ops.pagination, ops.linkingFields)
  }

  if (ops.reverse) {
    records.reverse()
  }

  if (Object.keys(ops.nested).length === 0) {
    return records
  }

  return records.map((record) => processNestedRecords(record, ops.nested))
}

function distinctBy(records: Record<string, unknown>[], fields: string[]): Record<string, unknown>[] {
  const seen = new Set()
  const result: Record<string, unknown>[] = []
  for (const record of records) {
    const key = getRecordKey(record, fields)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(record)
    }
  }
  return result
}

function paginate(records: {}[], pagination: Pagination, linkingFields: string[] | null): {}[] {
  if (linkingFields === null) {
    return paginateSingleList(records, pagination)
  }

  const groupedByParent = new Map<string, {}[]>()
  for (const record of records) {
    const parentKey = getRecordKey(record, linkingFields)
    if (!groupedByParent.has(parentKey)) {
      groupedByParent.set(parentKey, [])
    }
    groupedByParent.get(parentKey)!.push(record)
  }

  const groupList = Array.from(groupedByParent.entries())
  groupList.sort(([aId], [bId]) => (aId < bId ? -1 : aId > bId ? 1 : 0))

  return groupList.flatMap(([, elems]) => paginateSingleList(elems, pagination))
}

function paginateSingleList(list: {}[], { cursor, skip, take }: Pagination): {}[] {
  const cursorIndex = cursor !== null ? list.findIndex((item) => doKeysMatch(item, cursor)) : 0
  if (cursorIndex === -1) {
    return []
  }
  const start = cursorIndex + (skip ?? 0)
  const end = take !== null ? start + take : list.length

  return list.slice(start, end)
}

/*
 * Generate a key string for a record based on the values of the specified fields.
 */
export function getRecordKey(record: {}, fields: readonly string[], mappers?: ((value: unknown) => unknown)[]): string {
  const array = fields.map((field, index) =>
    mappers?.[index] ? (record[field] !== null ? mappers[index](record[field]) : null) : record[field],
  )
  return JSON.stringify(array)
}
