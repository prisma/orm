/**
 * Query shaping logic for Prisma query insights.
 *
 * Transforms JSON protocol query representations into Prisma-like format:
 * - Move `arguments` contents one level up
 * - Convert `selection` to `select`/`include`:
 *   - If `$scalars: true`, use `include` for relations
 *   - If no `$scalars`, use `select` for both scalars and relations
 * - Simplify relation selections to `true` when possible
 */

type Obj = Record<string, unknown>

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmpty(obj: Obj | undefined): boolean {
  return !obj || Object.keys(obj).length === 0
}

/**
 * Checks if a selection can be simplified to `true` (only $scalars/$composites, no other fields)
 */
function isSimpleSelection(selection: Obj | undefined): boolean {
  if (!selection || selection.$scalars !== true) return false
  return Object.keys(selection).every((k) => k === '$scalars' || k === '$composites')
}

/**
 * Shapes a value that could be a nested query, a simple selection, or a boolean.
 */
function shapeValue(value: unknown): unknown {
  if (value === true || !isObject(value)) return value

  // Check if it's a nested query (has arguments or selection keys)
  if ('arguments' in value || 'selection' in value) {
    const args = value.arguments as Obj | undefined
    const selection = value.selection as Obj | undefined

    // Can simplify to true if args empty and selection is simple
    if (isEmpty(args) && isSimpleSelection(selection)) {
      return true
    }

    return shapeQuery(value)
  }

  // It's a simple selection object (e.g., { $scalars: true })
  return isSimpleSelection(value) ? true : shapeQuery({ selection: value })
}

/**
 * Shapes a query object from JSON protocol format to Prisma-like format.
 */
export function shapeQuery(query: unknown): unknown {
  if (!isObject(query)) return query

  const args = query.arguments as Obj | undefined
  const selection = query.selection as Obj | undefined
  const result: Obj = args ? { ...args } : {}

  if (!selection) return result

  const hasScalars = selection.$scalars === true
  const fields: Obj = {}

  for (const [key, value] of Object.entries(selection)) {
    // Skip markers and boolean fields when $scalars is present (they're redundant)
    if (key === '$scalars' || key === '$composites') continue
    if (hasScalars && typeof value === 'boolean') continue

    fields[key] = typeof value === 'boolean' ? value : shapeValue(value)
  }

  if (Object.keys(fields).length > 0) {
    result[hasScalars ? 'include' : 'select'] = fields
  }

  return result
}
