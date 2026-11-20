import { Debug } from '@prisma/debug'
import {
  arg,
  BuiltInProvider,
  createSchemaPathInput,
  getCLIPathHash,
  getProjectHash,
  isCurrentBinInstalledGlobally,
  loadSchemaContext,
  parseEnvValue,
  type SchemaPathInput,
} from '@prisma/internals'
import type { Check } from 'checkpoint-client'
import * as checkpoint from 'checkpoint-client'

const packageJson = require('../../package.json')

const debug = Debug('prisma:cli:checkpoint')

/**
 * Collect and prepare data then run the Checkpoint Client which will send some info to the remote Checkpoint Server
 * It will be done in a child process so the CLI won't have to wait for it to finish to exit
 *
 * returns if the current CLI version is outdated.
 *
 * For more info about the data collected by the Checkpoint Server and how to disable it see:
 * https://pris.ly/d/telemetry
 */
export async function runCheckpointClientCheck({
  schemaPathFromConfig,
  baseDir,
}: {
  schemaPathFromConfig?: string
  baseDir: string
}): Promise<Check.Result | 0> {
  // If the user has disabled telemetry, we can stop here already.
  if (process.env['CHECKPOINT_DISABLE']) {
    // TODO: this breaks checkpoint-client abstraction, ideally it would export a reusable isGloballyDisabled() function
    debug('runCheckpointClientCheck() is disabled by the CHECKPOINT_DISABLE env var.')
    return 0
  }

  const commandArray = process.argv.slice(2)
  const args = arg(
    commandArray,
    {
      '--schema': String,
      '--telemetry-information': String,
    },
    false,
    true,
  )

  const schemaPathFromArgs = typeof args['--schema'] === 'string' ? args['--schema'] : undefined

  try {
    const startGetInfo = performance.now()
    const schemaPath = createSchemaPathInput({ schemaPathFromArgs, schemaPathFromConfig, baseDir })
    // Get some info about the project
    const [projectPathHash, { schemaProvider, schemaPreviewFeatures, schemaGeneratorsProviders }] = await Promise.all([
      // SHA256 identifier for the project based on the Prisma schema path
      getProjectHash(schemaPath),
      // Read schema and extract some data
      tryToReadDataFromSchema(schemaPath),
    ])
    // SHA256 of the cli path
    const cliPathHash = getCLIPathHash()

    const endGetInfo = performance.now()
    const getInfoElapsedTime = endGetInfo - startGetInfo
    debug(`runCheckpointClientCheck(): Execution time for getting info: ${getInfoElapsedTime} ms`)

    const data: Check.Input = {
      // Name of the product
      product: 'prisma',
      // Currently installed version of the CLI
      version: packageJson.version,
      // A unique hash of the path in which the CLI is installed
      cli_path_hash: cliPathHash,
      // A unique hash of the project's path, i.e.. the `schema.prisma`'s path
      project_hash: projectPathHash,
      // The first datasource provider (e.g. postgresql)
      schema_providers: schemaProvider ? [schemaProvider] : undefined,
      // previewFeatures from the prisma-client-js generator
      schema_preview_features: schemaPreviewFeatures,
      // Generator providers (e.g. prisma-client-js)
      schema_generators_providers: schemaGeneratorsProviders,
      // Type of CLI install: global or local
      cli_install_type: isCurrentBinInstalledGlobally() ? 'global' : 'local',
      // Command with redacted options
      command: redactCommandArray([...commandArray]).join(' '),
      // Internal: Additional information from `--telemetry-information` option or `PRISMA_TELEMETRY_INFORMATION` env var
      // Default: undefined
      information: args['--telemetry-information'] || process.env.PRISMA_TELEMETRY_INFORMATION,
      // Absolute CLI path
      // Note: This won't be sent to the checkpoint server.
      // TODO: Check if we can remove, probably not needed since cli_path_hash is defined
      cli_path: process.argv[1],
    }

    const startCheckpoint = performance.now()
    // Call Checkpoint Client and return result
    const checkpointResult = await checkpoint.check(data)
    const endCheckpoint = performance.now()
    const checkpointElapsedTime = endCheckpoint - startCheckpoint
    debug(`runCheckpointClientCheck(): Execution time for "await checkpoint.check(data)": ${checkpointElapsedTime} ms`)

    return checkpointResult
  } catch (e) {
    debug('Error from runCheckpointClientCheck()')
    debug(e)
    return 0
  }
}

/*
 * Tries to read some data from the Prisma Schema
 * if an error occurs it will silently fail and return undefined values
 */
export async function tryToReadDataFromSchema(schemaPath: SchemaPathInput) {
  let schemaProvider: string | undefined
  let schemaPreviewFeatures: string[] | undefined
  let schemaGeneratorsProviders: string[] | undefined

  try {
    const schemaContext = await loadSchemaContext({ schemaPath, printLoadMessage: false })

    if (schemaContext.datasources.length > 0) {
      schemaProvider = schemaContext.datasources[0].provider
    }

    // Example 'prisma-client-js'
    schemaGeneratorsProviders = schemaContext.generators
      // Check that value is defined
      .filter((generator) => generator && generator.provider)
      .map((generator) => parseEnvValue(generator.provider))

    const clientGeneratorProviders: string[] = [BuiltInProvider.PrismaClientTs, BuiltInProvider.PrismaClientJs]
    const previewFeatures = schemaContext.generators
      .filter((generator) => {
        const provider = generator?.provider ? parseEnvValue(generator.provider) : undefined
        return provider !== undefined && clientGeneratorProviders.includes(provider)
      })
      .flatMap((generator) => generator.previewFeatures ?? [])

    if (previewFeatures.length > 0) {
      schemaPreviewFeatures = Array.from(new Set(previewFeatures))
    }
  } catch (e) {
    debug(
      'Error from tryToReadDataFromSchema() while processing the schema. This is not a fatal error. It will continue without the processed data.',
    )
    debug(e)
  }

  return {
    schemaProvider,
    schemaPreviewFeatures,
    schemaGeneratorsProviders,
  }
}

/*
 * String options of the CLI
 * Tip: search for `: String,`
 */
export const SENSITIVE_CLI_OPTIONS = [
  // 1. Connection strings
  '--url',
  // 1. Paths
  '--schema',
  '--config',
  '--file',
  '--from-schema',
  '--to-schema',
  '--from-config-datasource',
  '--to-config-datasource',
  '--from-migrations',
  '--to-migrations',
  '--hostname',
  // 3. Migration names
  '--name',
  '--applied',
  '--rolled-back',
  // 4. Platform CLI
  '--token',
  '--api-key',
]
/*
 * removes potentially sensitive information from the command array (argv strings)
 */
export const redactCommandArray = (commandArray: string[]): string[] => {
  const REDACTED_TAG = '[redacted]'

  for (let i = 0; i < commandArray.length; i++) {
    const arg = commandArray[i]
    // redact --option arguments
    SENSITIVE_CLI_OPTIONS.forEach((option: string) => {
      // --url file:./dev.db
      // arg is `--url` and a complete match
      const argIndexCompleteMatch = arg === option
      // --url=file:./dev.db
      // arg value is `--url=file:./dev.db` and a partial match
      const argIndexPartialMatch = arg.indexOf(option)

      // First check for complete match and redact the value
      if (argIndexCompleteMatch) {
        commandArray[i + 1] = REDACTED_TAG
      }
      // else check for partial match and redact the value
      else if (argIndexPartialMatch !== -1) {
        commandArray[i] = `${option}=${REDACTED_TAG}`
      }
    })
  }

  return commandArray
}
