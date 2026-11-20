import crypto from 'crypto'

import { getSchemaWithPath, SchemaPathInput } from './getSchema'

/**
 * Get a unique identifier for the project by hashing
 * the directory with `schema.prisma`
 */
export async function getProjectHash(schemaPath: SchemaPathInput): Promise<string> {
  // Default to cwd if the schema couldn't be found
  const projectPath = (await getSchemaWithPath({ schemaPath }))?.schemaPath ?? process.cwd()

  return crypto.createHash('sha256').update(projectPath).digest('hex').substring(0, 8)
}

/**
 * Get a unique identifier for the CLI installation path
 * which can be either global or local (in project's node_modules)
 */
export function getCLIPathHash(): string {
  const cliPath = process.argv[1]
  return crypto.createHash('sha256').update(cliPath).digest('hex').substring(0, 8)
}
