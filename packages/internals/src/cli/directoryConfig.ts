import path from 'node:path'

import type { PrismaConfig } from '@prisma/config'

import { SchemaContext } from './schemaContext'

export type DirectoryConfig = {
  viewsDirPath: string
  typedSqlDirPath: string
  migrationsDirPath: string
}

/**
 * TODO: `config` should very likely be mandatory here.
 */
export function inferDirectoryConfig(
  schemaContext?: SchemaContext | null,
  config?: Pick<PrismaConfig, 'views' | 'typedSql' | 'migrations'>,
  cwd: string = process.cwd(),
): DirectoryConfig {
  const baseDir =
    // If no primary datasource exists we use the schemaRootDir.
    // `schemaRootDir` is either the directory the user supplied as schemaPath or the directory the single schema file is in.
    schemaContext?.schemaRootDir ??
    // Should also that not be defined because there is no schema yet we fallback to CWD + `/prisma`.
    path.join(cwd, 'prisma')

  return {
    viewsDirPath: config?.views?.path ?? path.join(baseDir, 'views'),
    typedSqlDirPath: config?.typedSql?.path ?? path.join(baseDir, 'sql'),
    migrationsDirPath: config?.migrations?.path ?? path.join(baseDir, 'migrations'),
  }
}
