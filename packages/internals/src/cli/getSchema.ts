import { Debug } from '@prisma/debug'
import { MultipleSchemaTuple } from '@prisma/get-dmmf'
import type {
  GetSchemaResult,
  LookupResult,
  NonFatalLookupError,
  SuccessfulLookupResult,
} from '@prisma/schema-files-loader'
import { ensureType, loadSchemaFiles } from '@prisma/schema-files-loader'
import fs from 'fs'
import { dim, green } from 'kleur/colors'
import path from 'path'
import { promisify } from 'util'

const readFile = promisify(fs.readFile)
const stat = promisify(fs.stat)

const debug = Debug('prisma:getSchema')

type DefaultLookupRuleFailure = {
  path: string
  error: NonFatalLookupError
}

type DefaultLookupError = {
  kind: 'NotFoundMultipleLocations'
  failures: DefaultLookupRuleFailure[]
}

type DefaultLookupResult =
  | SuccessfulLookupResult
  | {
      ok: false
      error: DefaultLookupError
    }

export type GetSchemaOptions = {
  schemaPath: SchemaPathInput
  cwd?: string
  argumentName?: string
}

type GetSchemaInternalOptions = Required<GetSchemaOptions>

/**
 * Creates SchemaPathInput based on a combination of possible inputs
 * from CLI args, config file, or base directory.
 * `baseDir` is either the directory containing the prisma config file or the working directory
 * of the CLI invocation if no config file is found.
 */
export function createSchemaPathInput({
  schemaPathFromArgs,
  schemaPathFromConfig,
  baseDir,
}: {
  schemaPathFromArgs?: string
  schemaPathFromConfig?: string
  baseDir: string
}): SchemaPathInput {
  return schemaPathFromArgs
    ? { cliProvidedPath: schemaPathFromArgs }
    : schemaPathFromConfig
      ? { configProvidedPath: schemaPathFromConfig }
      : { baseDir }
}

/**
 * Loads the schema, throws an error if it is not found
 */
export async function getSchemaWithPath({
  schemaPath,
  cwd = process.cwd(),
  argumentName = '--schema',
}: GetSchemaOptions): Promise<GetSchemaResult> {
  const result = await getSchemaWithPathInternal({ schemaPath, cwd, argumentName })
  if (result.ok) {
    return result.schema
  }
  throw new Error(renderDefaultLookupError(result.error, cwd))
}

/**
 * The schema path can be provided as a CLI argument, a configuration file, or a base directory
 * that is expected to contain the schema in one of the default locations.
 */
export type SchemaPathInput = { cliProvidedPath: string } | { configProvidedPath: string } | { baseDir: string }

/**
 * Loads the schema, returns null if it is not found
 * Throws an error if schema is specified explicitly in
 * any of the available ways (argument, package.json config), but
 * can not be loaded
 * @param schemaPathFromArgs
 * @param schemaPathFromConfig
 * @param opts
 * @returns
 */
export async function getSchemaWithPathOptional({
  schemaPath,
  cwd = process.cwd(),
  argumentName = '--schema',
}: GetSchemaOptions): Promise<GetSchemaResult | null> {
  const result = await getSchemaWithPathInternal({ schemaPath, cwd, argumentName })
  if (result.ok) {
    return result.schema
  }
  return null
}

export function printSchemaLoadedMessage(schemaPath: string) {
  process.stderr.write(dim(`Prisma schema loaded from ${path.relative(process.cwd(), schemaPath)}.`) + '\n')
}

async function readSchemaFromSingleFile(schemaPath: string): Promise<LookupResult> {
  debug('Reading schema from single file', schemaPath)

  const typeError = await ensureType(schemaPath, 'file')
  if (typeError) {
    return { ok: false, error: typeError }
  }
  const file = await readFile(schemaPath, { encoding: 'utf-8' })
  const schemaTuple: MultipleSchemaTuple = [schemaPath, file]
  return {
    ok: true,
    schema: { schemaPath, schemaRootDir: path.dirname(schemaPath), schemas: [schemaTuple] },
  } as const
}

async function readSchemaFromDirectory(schemaPath: string): Promise<LookupResult> {
  debug('Reading schema from multiple files', schemaPath)
  const typeError = await ensureType(schemaPath, 'directory')
  if (typeError) {
    return { ok: false, error: typeError }
  }
  const files = await loadSchemaFiles(schemaPath)
  return { ok: true, schema: { schemaPath, schemaRootDir: schemaPath, schemas: files } }
}

async function readSchemaFromFileOrDirectory(schemaPath: string): Promise<LookupResult> {
  let stats: fs.Stats
  try {
    stats = await stat(schemaPath)
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { ok: false, error: { kind: 'NotFound', path: schemaPath } }
    }
    throw e
  }

  if (stats.isFile()) {
    return readSchemaFromSingleFile(schemaPath)
  }

  if (stats.isDirectory()) {
    return readSchemaFromDirectory(schemaPath)
  }

  return { ok: false, error: { kind: 'WrongType', path: schemaPath, expectedTypes: ['file', 'directory'] } }
}

/**
 * Tries to load schema from either provided
 * arg, Prisma config file location, default location relative to cwd
 * or any of the Yarn1Workspaces.
 *
 * If schema is specified explicitly with any of the methods but can
 * not be loaded, error will be thrown. If no explicit schema is given, then
 * error value will be returned instead
 */
async function getSchemaWithPathInternal({
  schemaPath,
  cwd,
  argumentName,
}: GetSchemaInternalOptions): Promise<DefaultLookupResult> {
  // 1. Try the user custom path, when provided.
  if ('cliProvidedPath' in schemaPath) {
    return {
      ok: true,
      schema: await getCliProvidedSchemaFile(schemaPath.cliProvidedPath, cwd, argumentName),
    }
  }

  // 2. Try the `schema` from `PrismaConfig`
  if ('configProvidedPath' in schemaPath) {
    return {
      ok: true,
      schema: await getConfigProvidedSchemaFile(schemaPath.configProvidedPath),
    }
  }

  // 3. Look into the default, "canonical" locations in the cwd (e.g., `./schema.prisma` or `./prisma/schema.prisma`)
  const defaultResult = await getDefaultSchema(schemaPath.baseDir)
  if (defaultResult.ok) {
    return defaultResult
  }

  return {
    ok: false as const,
    error: defaultResult.error,
  }
}

function renderLookupError(error: NonFatalLookupError) {
  switch (error.kind) {
    case 'NotFound': {
      const expected = error.expectedType ?? 'file or directory'
      return `${expected} not found`
    }
    case 'WrongType':
      return `expected ${error.expectedTypes.join(' or ')}`
  }
}

function renderDefaultLookupError(error: DefaultLookupError, cwd: string) {
  const parts: string[] = [
    `Could not find Prisma Schema that is required for this command.`,
    `You can either provide it with ${green('`--schema`')} argument,`,
    `set it in your Prisma Config file (e.g., ${green('`prisma7.config.ts`')}),`,
    `set it as ${green('`prisma.schema`')} in your ${green('package.json')},`,
    `or put it into the default location (${green('`./prisma/schema.prisma`')}, or ${green('`./schema.prisma`')}.`,
    'Checked following paths:\n',
  ]
  const printedPaths = new Set<string>()
  for (const failure of error.failures) {
    const filePath = failure.path
    if (!printedPaths.has(failure.path)) {
      parts.push(`${path.relative(cwd, filePath)}: ${renderLookupError(failure.error)}`)
      printedPaths.add(filePath)
    }
  }
  parts.push('\nSee also https://pris.ly/d/prisma-schema-location')
  return parts.join('\n')
}

export async function getCliProvidedSchemaFile(
  schemaPathFromArgs: string,
  cwd: string = process.cwd(),
  argumentName: string = '--schema',
): Promise<GetSchemaResult> {
  const absPath = path.resolve(cwd, schemaPathFromArgs)
  const customSchemaResult = await readSchemaFromFileOrDirectory(absPath)
  if (!customSchemaResult.ok) {
    const relPath = path.relative(cwd, absPath)
    throw new Error(
      `Could not load \`${argumentName}\` from provided path \`${relPath}\`: ${renderLookupError(
        customSchemaResult.error,
      )}`,
    )
  }

  return customSchemaResult.schema
}

export async function getConfigProvidedSchemaFile(schemaPathFromConfig: string): Promise<GetSchemaResult> {
  const schemaResult = await readSchemaFromFileOrDirectory(schemaPathFromConfig)

  if (!schemaResult.ok) {
    throw new Error(
      `Could not load schema from \`${schemaPathFromConfig}\` provided by the Prisma config file: ${renderLookupError(
        schemaResult.error,
      )}`,
    )
  }

  return schemaResult.schema
}

async function getDefaultSchema(cwd: string, failures: DefaultLookupRuleFailure[] = []): Promise<DefaultLookupResult> {
  const lookupPaths = [path.join(cwd, 'schema.prisma'), path.join(cwd, 'prisma', 'schema.prisma')]
  for (const path of lookupPaths) {
    debug(`Checking existence of ${path}`)
    const schema = await readSchemaFromSingleFile(path)
    if (!schema.ok) {
      failures.push({ path, error: schema.error })
      continue
    }

    return schema
  }

  return {
    ok: false,
    error: {
      kind: 'NotFoundMultipleLocations',
      failures,
    },
  }
}
