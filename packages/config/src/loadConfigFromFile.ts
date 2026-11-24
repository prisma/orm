import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

import { Debug } from '@prisma/debug'

import { defaultConfig } from './defaultConfig'
import type { PrismaConfigInternal } from './defineConfig'
import { parseDefaultExport } from './PrismaConfig'

const debug = Debug('prisma:config:loadConfigFromFile')

// Note: as of c12@3.1.0, config extensions are tried in the following order, regardless of how we pass them
// to `jiti` or to `jitiOptions.extensions`.
// See: https://github.com/unjs/c12/blob/1efbcbce0e094a8f8a0ba676324affbef4a0ba8b/src/loader.ts#L35-L42
export const SUPPORTED_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs', '.mts', '.cts'] as const satisfies string[]

const PRISMA7_CONFIG_FILE_CANDIDATES = [
  ...SUPPORTED_EXTENSIONS.map((extension) => `prisma7.config${extension}`),
  ...SUPPORTED_EXTENSIONS.map((extension) => path.join('.config', `prisma7${extension}`)),
] as const satisfies readonly string[]

const LEGACY_CONFIG_FILE_BASENAMES = [
  'prisma.config',
  path.join('.config', 'prisma'),
  path.join('.config', 'prisma.config'),
] as const

const LEGACY_CONFIG_FILE_CANDIDATES = LEGACY_CONFIG_FILE_BASENAMES.flatMap((basename) => [
  ...SUPPORTED_EXTENSIONS.map((extension) => `${basename}${extension}`),
  ...SUPPORTED_EXTENSIONS.map((extension) => path.join(basename, `index${extension}`)),
])

/**
 * Find the highest-precedence Prisma 7-specific config file without loading it.
 */
function findPrisma7ConfigFile(configRoot = process.cwd()): string | null {
  return findFirstConfigFile(PRISMA7_CONFIG_FILE_CANDIDATES, configRoot)
}

/**
 * Find the config file selected by automatic Prisma 7 discovery without loading it.
 */
export function findPrismaConfigFile(configRoot = process.cwd()): string | null {
  return findPrisma7ConfigFile(configRoot) ?? findFirstConfigFile(LEGACY_CONFIG_FILE_CANDIDATES, configRoot)
}

function findFirstConfigFile(candidates: readonly string[], configRoot: string): string | null {
  for (const candidate of candidates) {
    const resolvedPath = path.resolve(configRoot, candidate)

    if (fs.statSync(resolvedPath, { throwIfNoEntry: false })?.isFile()) {
      return resolvedPath
    }
  }

  return null
}

type LoadConfigFromFileInput = {
  /**
   * The path to the config file to load. If not provided, we will attempt to find a config file in the `configRoot` directory.
   */
  configFile?: string

  /**
   * The directory to search for the config file in. Defaults to the current working directory.
   */
  configRoot?: string
}

export type LoadConfigFromFileError =
  | {
      /**
       * The config file was not found at the specified path.
       */
      _tag: 'ConfigFileNotFound'
    }
  | {
      _tag: 'ConfigLoadError'
      error: Error
    }
  | {
      _tag: 'ConfigFileSyntaxError'
      error: Error
    }
  | {
      _tag: 'UnknownError'
      error: Error
    }

export type InjectFormatters = {
  dim: (data: string) => string
  log: (data: string) => void
  warn: (data: string) => void
  link: (data: string) => string
}

export type ConfigDiagnostic =
  | {
      _tag: 'log'
      value: (formatters: InjectFormatters) => () => void
    }
  | {
      _tag: 'warn'
      value: (formatters: InjectFormatters) => () => void
    }

export type ConfigFromFile =
  | {
      resolvedPath: string
      config: PrismaConfigInternal
      error?: never
      diagnostics: ConfigDiagnostic[]
    }
  | {
      resolvedPath: string
      config?: never
      error: LoadConfigFromFileError
      diagnostics: ConfigDiagnostic[]
    }
  | {
      resolvedPath: null
      config: PrismaConfigInternal
      error?: never
      diagnostics: ConfigDiagnostic[]
    }

/**
 * Load a Prisma config file from the given directory.
 * This function may fail, but it will never throw.
 * The possible error is returned in the result object, so the caller can handle it as needed.
 */

export async function loadConfigFromFile({
  configFile,
  configRoot = process.cwd(),
}: LoadConfigFromFileInput): Promise<ConfigFromFile> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  const diagnostics = [] as ConfigDiagnostic[]

  try {
    const selectedConfigFile = configFile ?? findPrisma7ConfigFile(configRoot) ?? undefined
    const { configModule, resolvedPath, error } = await loadConfigTsOrJs(configRoot, selectedConfigFile)

    if (error) {
      return {
        resolvedPath,
        error,
        diagnostics,
      }
    }

    debug(`Config file loaded in %s`, getTime())

    if (resolvedPath === null) {
      debug(`No config file found in the current working directory %s`, configRoot)

      return { resolvedPath: null, config: defaultConfig(), diagnostics }
    }

    let parsedConfig: PrismaConfigInternal | undefined

    try {
      parsedConfig = parseDefaultExport(configModule)
    } catch (e) {
      const error = e as Error
      return {
        resolvedPath,
        error: {
          _tag: 'ConfigFileSyntaxError',
          error,
        },
        diagnostics,
      }
    }

    // Note: this line fixes https://github.com/prisma/prisma/issues/27609.
    diagnostics.push({
      _tag: 'log',
      value:
        ({ log, dim }) =>
        () =>
          log(dim(`Loaded Prisma config from ${path.relative(configRoot, resolvedPath)}.\n`)),
    })

    const prismaConfig = transformPathsInConfigToAbsolute(parsedConfig, resolvedPath)

    return {
      config: {
        ...prismaConfig,
        loadedFromFile: resolvedPath,
      },
      resolvedPath,
      diagnostics,
    }
  } catch (e) {
    // As far as we know, this branch should be unreachable.
    const error = e as Error

    return {
      resolvedPath: configRoot,
      error: {
        _tag: 'UnknownError',
        error,
      },
      diagnostics,
    }
  }
}

async function loadConfigTsOrJs(configRoot: string, configFile: string | undefined) {
  const { loadConfig: loadConfigWithC12 } = await import('c12')
  const { deepmerge } = await import('deepmerge-ts')

  try {
    const {
      config,
      configFile: _resolvedPath,
      meta,
    } = await loadConfigWithC12({
      cwd: configRoot,
      // configuration base name
      name: 'prisma',
      // the config file to load (without file extensions), defaulting to `${cwd}.${name}`
      configFile,
      // do not load .env files
      dotenv: false,
      // do not load RC config
      rcFile: false,
      // do not extend remote config files
      giget: false,
      // do not extend the default config
      extend: false,
      // do not load from nearest package.json
      packageJson: false,

      // @ts-expect-error: this is a type-error in `c12` itself
      merger: deepmerge,

      jitiOptions: {
        interopDefault: true,
        moduleCache: false,
        extensions: SUPPORTED_EXTENSIONS,
      },
    })

    // Note: c12 apparently doesn't normalize paths on Windows, causing issues with Windows tests.
    const resolvedPath = _resolvedPath ? path.normalize(_resolvedPath) : undefined
    const doesConfigFileExist = resolvedPath !== undefined && meta !== undefined

    if (configFile && !doesConfigFileExist) {
      debug(`The given config file was not found at %s`, resolvedPath)
      return {
        require: null,
        resolvedPath: path.join(configRoot, configFile),
        error: { _tag: 'ConfigFileNotFound' } as const,
      } as const
    }

    if (doesConfigFileExist) {
      const extension = path.extname(path.basename(resolvedPath))

      if (!(SUPPORTED_EXTENSIONS as string[]).includes(extension)) {
        return {
          configModule: config,
          resolvedPath,
          error: {
            _tag: 'ConfigLoadError',
            error: new Error(`Unsupported Prisma config file extension: ${extension}`),
          } as const,
        } as const
      }
    }

    return {
      configModule: config,
      resolvedPath: doesConfigFileExist ? resolvedPath : null,
      error: null,
    } as const
  } catch (e) {
    const error = e as Error
    debug('jiti import failed: %s', error.message)

    // Extract the location of automatically discovered legacy config files from jiti's wrapped BABEL_PARSE_ERROR message.
    const configFileMatch = error.message.match(/prisma\.config\.(\w+)/)
    const extension = configFileMatch?.[1]
    const filenameWithExtension = configFile
      ? path.resolve(configRoot, configFile)
      : path.join(configRoot, extension ? `prisma.config.${extension}` : '')
    debug('faulty config file: %s', filenameWithExtension)

    return {
      error: {
        _tag: 'ConfigLoadError',
        error,
      } as const,
      resolvedPath: filenameWithExtension,
    } as const
  }
}

function transformPathsInConfigToAbsolute(
  prismaConfig: PrismaConfigInternal,
  resolvedPath: string,
): PrismaConfigInternal {
  function resolvePath(value: string | undefined) {
    if (!value) {
      return undefined
    }

    return path.resolve(path.dirname(resolvedPath), value)
  }

  return {
    ...prismaConfig,
    schema: resolvePath(prismaConfig.schema),
    migrations: {
      ...prismaConfig.migrations,
      path: resolvePath(prismaConfig.migrations?.path),
    },
    typedSql: {
      ...prismaConfig.typedSql,
      path: resolvePath(prismaConfig.typedSql?.path),
    },
    views: {
      ...prismaConfig.views,
      path: resolvePath(prismaConfig.views?.path),
    },
  }
}
