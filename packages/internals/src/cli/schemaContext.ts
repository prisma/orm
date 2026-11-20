import path from 'node:path'

import { ActiveConnectorType, DataSource, GeneratorConfig } from '@prisma/generator'
import { GetSchemaResult, LoadedFile } from '@prisma/schema-files-loader'

import { getConfig } from '../engine-commands'
import { getSchemaWithPath, getSchemaWithPathOptional, printSchemaLoadedMessage, SchemaPathInput } from './getSchema'

export type SchemaContext = {
  /**
   * All loaded schema files and their paths.
   */
  schemaFiles: LoadedFile[]
  /**
   * The root directory of the schema files.
   * Either set explicitly from a schema folder based config or the parent directory of the schema.prisma file.
   */
  schemaRootDir: string
  /**
   * The path that shall be printed in user facing logs messages informing them from where the schema was loaded.
   */
  loadedFromPathForLogMessages: string
  /**
   * The datasource extracted from the Prisma schema. So far we only support a single datasource block.
   */
  primaryDatasource: DataSource | undefined
  /**
   * Warnings that were raised during Prisma schema parsing.
   */
  warnings: string[] | []
  /**
   * The datasources extracted from the Prisma schema. Prefer to use primaryDatasource for most cases.
   */
  datasources: DataSource[] | []
  /**
   * The generators extracted from the Prisma schema.
   */
  generators: GeneratorConfig[] | []
  /**
   * @deprecated Only used during the refactoring for backwards compatibility. Use `schemaFiles` instead or determine needed file paths otherwise.
   */
  schemaPath: string
}

type LoadSchemaContextOptions = {
  schemaPath: SchemaPathInput
  printLoadMessage?: boolean
  allowNull?: boolean
  schemaPathArgumentName?: string
  cwd?: string
}

export async function loadSchemaContext(
  opts: LoadSchemaContextOptions & { allowNull: true },
): Promise<SchemaContext | null>
export async function loadSchemaContext(opts?: LoadSchemaContextOptions): Promise<SchemaContext>
export async function loadSchemaContext(
  { schemaPath, printLoadMessage, allowNull, schemaPathArgumentName, cwd }: LoadSchemaContextOptions = {
    schemaPath: { baseDir: process.cwd() },
    printLoadMessage: true,
    allowNull: false,
    schemaPathArgumentName: '--schema',
    cwd: process.cwd(),
  },
): Promise<SchemaContext | null> {
  let schemaResult: GetSchemaResult | null = null

  if (allowNull) {
    schemaResult = await getSchemaWithPathOptional({ schemaPath, cwd, argumentName: schemaPathArgumentName })
    if (!schemaResult) return null
  } else {
    schemaResult = await getSchemaWithPath({ schemaPath, cwd, argumentName: schemaPathArgumentName })
  }

  return processSchemaResult({ schemaResult, printLoadMessage, cwd })
}

export async function processSchemaResult({
  schemaResult,
  printLoadMessage = true,
  cwd = process.cwd(),
}: {
  schemaResult: GetSchemaResult
  printLoadMessage?: boolean
  cwd?: string
}): Promise<SchemaContext> {
  const loadedFromPathForLogMessages = path.relative(cwd, schemaResult.schemaPath)
  const schemaRootDir = schemaResult.schemaRootDir || cwd

  if (printLoadMessage) {
    printSchemaLoadedMessage(loadedFromPathForLogMessages)
  }

  const configFromPsl = await getConfig({ datamodel: schemaResult.schemas })

  const primaryDatasource = configFromPsl.datasources.at(0)

  return {
    schemaFiles: schemaResult.schemas,
    schemaPath: schemaResult.schemaPath,
    schemaRootDir,
    datasources: configFromPsl.datasources,
    generators: configFromPsl.generators,
    primaryDatasource,
    warnings: configFromPsl.warnings,
    loadedFromPathForLogMessages,
  }
}

export function getSchemaDatasourceProvider(schemaContext: SchemaContext): ActiveConnectorType {
  if (schemaContext.primaryDatasource === undefined) {
    throw new Error('Schema must contain a datasource block')
  }
  return schemaContext.primaryDatasource.activeProvider
}
