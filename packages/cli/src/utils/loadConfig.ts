import {
  type ConfigDiagnostic,
  loadConfigFromFile,
  PrismaConfigEnvError,
  type PrismaConfigInternal,
} from '@prisma/config'
import { Debug } from '@prisma/debug'
import { assertNever, HelpError } from '@prisma/internals'

const debug = Debug('prisma:cli:loadConfig')

/**
 * Will try to load the prisma config file from the given path, default path or create a default config.
 */
export async function loadConfig(
  configFilePath?: string,
): Promise<{ config: PrismaConfigInternal; diagnostics: ConfigDiagnostic[] } | HelpError> {
  const { config, error, resolvedPath, diagnostics } = await loadConfigFromFile({ configFile: configFilePath })

  if (error) {
    debug('Error loading config file: %o', error)
    switch (error._tag) {
      case 'ConfigFileNotFound':
        return new HelpError(`Config file not found at "${resolvedPath}"`)

      case 'ConfigLoadError':
        if (error.error instanceof PrismaConfigEnvError) {
          diagnostics.push({
            _tag: 'warn',
            value: (formatters) => () => {
              formatters.log(formatters.dim(`${error.error.message}`))
            },
          })
        }

        return new HelpError(
          `Failed to load config file "${resolvedPath}" as a TypeScript/JavaScript module. Error: ${error.error}`,
        )

      case 'ConfigFileSyntaxError':
        return new HelpError(`Failed to parse syntax of config file at "${resolvedPath}"`)

      case 'UnknownError':
        return new HelpError(`Unknown error during config file loading: ${error.error}`)

      default:
        assertNever(error, `Unhandled error '${JSON.stringify(error)}' in 'loadConfigFromFile'.`)
    }
  }

  return { config, diagnostics }
}
