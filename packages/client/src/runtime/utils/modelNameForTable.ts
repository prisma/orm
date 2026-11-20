import type { RuntimeDataModel } from '@prisma/client-common'

/**
 * Maps a physical table name reported by a driver adapter back to the name of
 * the Prisma model backed by that table, taking `@@map` and `@@schema` into
 * account.
 *
 * The reported table may be schema-qualified (`<schema>.<table>`). When a table
 * name is shared by more than one model in different database schemas, the
 * models are disambiguated by the reported schema, provided the runtime data
 * model carries per-model schema information (older generated clients and the
 * pruned edge data model may not).
 *
 * Returns `undefined` when no model matches or when the match stays ambiguous
 * (several models map to the reported table and the schema is not available to
 * tell them apart), so that the caller can fall back to the top-level
 * operation's model name instead of guessing.
 */
export function modelNameForTable(runtimeDataModel: RuntimeDataModel, table: string): string | undefined {
  const { schema, name } = parseTableName(table)

  const candidates = Object.entries(runtimeDataModel.models).filter(
    ([modelName, model]) => (model.dbName ?? modelName) === name,
  )

  if (candidates.length <= 1) {
    return candidates[0]?.[0]
  }

  if (schema !== undefined) {
    const schemaMatches = candidates.filter(([, model]) => model.schema === schema)
    if (schemaMatches.length === 1) {
      return schemaMatches[0][0]
    }
  }

  return undefined
}

function parseTableName(table: string): { schema: string | undefined; name: string } {
  const separatorIndex = table.lastIndexOf('.')
  if (separatorIndex === -1) {
    return { schema: undefined, name: table }
  }
  return { schema: table.slice(0, separatorIndex), name: table.slice(separatorIndex + 1) }
}
