import type { SqlCommenterContext, SqlCommenterPlugin } from '@prisma/sqlcommenter'
import { klona } from 'klona'

/**
 * Formats key-value pairs into a sqlcommenter-compatible comment string.
 *
 * Algorithm per https://google.github.io/sqlcommenter/spec/:
 * 1. If the map is empty, return empty string
 * 2. Sort keys lexicographically
 * 3. URL-encode keys
 * 4. URL-encode values
 * 5. Replace ' with \' in values (after URL encoding)
 * 6. Wrap values in single quotes
 * 7. Join key='value' pairs with commas
 * 8. Wrap in a SQL comment
 */
export function formatSqlComment(tags: Record<string, string>): string {
  const entries = Object.entries(tags)
  if (entries.length === 0) {
    return ''
  }

  // Sort by key lexicographically
  entries.sort(([a], [b]) => a.localeCompare(b))

  const parts = entries.map(([key, value]) => {
    const encodedKey = encodeURIComponent(key)
    const encodedValue = encodeURIComponent(value).replace(/'/g, "\\'")
    return `${encodedKey}='${encodedValue}'`
  })

  return `/*${parts.join(',')}*/`
}

/**
 * Applies SQL commenter plugins and returns the merged key-value pairs.
 * Keys with undefined values are filtered out.
 *
 * Each plugin receives a deep clone of the context to prevent mutations
 * that could affect other plugins.
 */
export function applySqlCommenters(
  plugins: SqlCommenterPlugin[],
  context: SqlCommenterContext,
): Record<string, string> {
  const merged: Record<string, string> = {}

  for (const plugin of plugins) {
    const tags = plugin(klona(context))
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined) {
        merged[key] = value
      }
    }
  }

  return merged
}

/**
 * Applies SQL commenter plugins and returns the formatted comment.
 */
export function buildSqlComment(plugins: SqlCommenterPlugin[], context: SqlCommenterContext): string {
  const tags = applySqlCommenters(plugins, context)
  return formatSqlComment(tags)
}

/**
 * Appends a sqlcommenter comment to a SQL query.
 */
export function appendSqlComment(sql: string, comment: string): string {
  if (!comment) {
    return sql
  }
  return `${sql} ${comment}`
}
