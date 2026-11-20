import { inferDirectoryConfig, isValidJsIdentifier, type SchemaContext } from '@prisma/internals'
import { PrismaConfigWithDatasource } from '@prisma/internals'
import { introspectSql as migrateIntrospectSql, IntrospectSqlError, IntrospectSqlInput } from '@prisma/migrate'
import fs from 'fs/promises'
import { bold } from 'kleur/colors'
import path from 'path'

const SQL_DIR = 'sql'

export async function introspectSql(config: PrismaConfigWithDatasource, baseDir: string, schemaContext: SchemaContext) {
  const directoryConfig = inferDirectoryConfig(schemaContext, config)
  const sqlFiles = await readTypedSqlFiles(directoryConfig.typedSqlDirPath)
  const introspectionResult = await migrateIntrospectSql(schemaContext, config, baseDir, sqlFiles)
  if (introspectionResult.ok) {
    return introspectionResult.queries
  }
  throw new Error(renderErrors(introspectionResult.errors))
}

export function sqlDirPath(schemaRootDir: string) {
  return path.join(schemaRootDir, SQL_DIR)
}

async function readTypedSqlFiles(typedSqlDirPath: string): Promise<IntrospectSqlInput[]> {
  const files = await fs.readdir(typedSqlDirPath)
  const results: IntrospectSqlInput[] = []
  for (const fileName of files) {
    const { name, ext } = path.parse(fileName)
    if (ext !== '.sql') {
      continue
    }
    const absPath = path.join(typedSqlDirPath, fileName)
    if (!isValidJsIdentifier(name)) {
      throw new Error(`${absPath} can not be used as a typed sql query: name must be a valid JS identifier`)
    }
    if (name.startsWith('$')) {
      throw new Error(`${absPath} can not be used as a typed sql query: name must not start with $`)
    }
    const source = await fs.readFile(path.join(typedSqlDirPath, fileName), 'utf8')
    results.push({
      name,
      source,
      fileName: absPath,
    })
  }

  return results
}

function renderErrors(errors: IntrospectSqlError[]) {
  const lines: string[] = [`Errors while reading sql files:\n`]
  for (const { fileName, message } of errors) {
    lines.push(`In ${bold(path.relative(process.cwd(), fileName))}:`)
    lines.push(message)
    lines.push('')
  }
  return lines.join('\n')
}
