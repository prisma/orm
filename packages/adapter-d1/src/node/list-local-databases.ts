import fs from 'node:fs'
import path from 'node:path'

const localD1DatabasePath = path.join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')

/**
 * Lists all local D1 databases found in the Wrangler state directory.
 *
 * This function scans the `.wrangler/state/v3/d1/miniflare-D1DatabaseObject` directory
 * for SQLite database files and returns their paths.
 *
 * @returns An array of file paths to local D1 database files
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@prisma/config'
 * import { listLocalDatabases } from '@prisma/adapter-d1'
 *
 * export default defineConfig({
 *   datasource: {
 *     url: `file:${listLocalDatabases().pop()}`,
 *   },
 * })
 * ```
 */
export function listLocalDatabases(): string[] {
  const cwd = process.cwd()
  const d1DirPath = path.join(cwd, localD1DatabasePath)
  const files = fs.readdirSync(d1DirPath)
  return files.filter((file) => file.endsWith('.sqlite')).map((file) => path.join(d1DirPath, file))
}
