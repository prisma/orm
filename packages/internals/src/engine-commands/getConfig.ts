import Debug from '@prisma/debug'
import type { DataSource, GeneratorConfig } from '@prisma/generator'
import { SchemaFileInput } from '@prisma/get-dmmf'
import { getBinaryTargetForCurrentPlatform } from '@prisma/get-platform'
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/lib/function'
import { bold, red } from 'kleur/colors'
import { match } from 'ts-pattern'

import { ErrorArea, getWasmError, isWasmPanic, RustPanic, WasmPanic } from '../panic'
import { prismaSchemaWasm } from '../wasm'
import { addVersionDetailsToErrorMessage } from './errorHelpers'
import {
  createDebugErrorType,
  createSchemaValidationError,
  parseQueryEngineError,
  QueryEngineErrorInit,
} from './queryEngineCommons'
import { relativizePathInPSLError } from './relativizePathInPSLError'

const debug = Debug('prisma:getConfig')
const SCHEMA_VALIDATION_ERROR_CODE = 'P1012'

export interface GetConfigResponse {
  config: ConfigMetaFormat
  errors: GetConfigValidationError[]
}

export interface ConfigMetaFormat {
  datasources: DataSource[] | []
  generators: GeneratorConfig[] | []
  warnings: string[] | []
}

interface GetConfigValidationError {
  fileName: string | null
  message: string
}

export type GetConfigOptions = {
  datamodel: SchemaFileInput
}

export class GetConfigError extends Error {
  constructor(params: QueryEngineErrorInit) {
    const constructedErrorMessage = match(params)
      .with({ _tag: 'parsed' }, ({ errorCode, message, reason }) => {
        const errorCodeMessage = errorCode ? `Error code: ${errorCode}` : ''
        return `${reason}
${errorCodeMessage}
${message}`
      })
      .with({ _tag: 'unparsed' }, ({ message, reason }) => {
        const detailsHeader = red(bold('Details:'))
        return `${reason}
${detailsHeader} ${message}`
      })
      .exhaustive()

    const errorMessageWithContext = `${constructedErrorMessage}
[Context: getConfig]`

    super(addVersionDetailsToErrorMessage(errorMessageWithContext))
    this.name = 'GetConfigError'
  }
}

/**
 * Wasm'd version of `getConfig`.
 */
export async function getConfig(options: GetConfigOptions): Promise<ConfigMetaFormat> {
  const debugErrorType = createDebugErrorType(debug, 'getConfigWasm')
  debug(`Using getConfig Wasm`)

  const configEither = pipe(
    E.tryCatch(
      () => {
        if (process.env.FORCE_PANIC_GET_CONFIG) {
          debug('Triggering a Rust panic...')
          prismaSchemaWasm.debug_panic()
        }

        const params = JSON.stringify({ prismaSchema: options.datamodel })

        return prismaSchemaWasm.get_config(params)
      },
      (e) => ({
        type: 'wasm-error' as const,
        reason: '(get-config wasm)',
        error: e as Error | WasmPanic,
      }),
    ),
    E.map((result) => ({ result })),
    E.chainW(({ result }) =>
      // NOTE: this should never fail, as we expect returned values to be valid JSON-serializable strings
      E.tryCatch(
        () => JSON.parse(result) as GetConfigResponse,
        (e) => ({
          type: 'parse-json' as const,
          reason: 'Unable to parse JSON',
          error: e as Error,
        }),
      ),
    ),
    E.chainW((response) => {
      if (response.errors.length > 0) {
        return E.left({
          type: 'validation-error' as const,
          reason: '(get-config wasm)',
          error: response.errors,
        })
      }
      return E.right(response.config)
    }),
  )

  if (E.isRight(configEither)) {
    debug('config data retrieved without errors in getConfig Wasm')
    const { right: data } = configEither

    for (const generator of data.generators) {
      await resolveBinaryTargets(generator)
    }

    return Promise.resolve(data)
  }

  /**
   * Check which error to throw.
   */
  const error = match(configEither.left)
    .with({ type: 'wasm-error' }, (e) => {
      debugErrorType(e)

      /**
       * Capture and propagate possible Wasm panics.
       */
      if (isWasmPanic(e.error)) {
        const { message, stack } = getWasmError(e.error)

        const panic = new RustPanic(
          /* message */ message,
          /* rustStack */ stack,
          /* request */ '@prisma/prisma-schema-wasm get_config',
          ErrorArea.FMT_CLI,
        )
        return panic
      }

      const errorOutput = e.error.message
      return new GetConfigError(parseQueryEngineError({ errorOutput, reason: e.reason }))
    })
    .with({ type: 'validation-error' }, (e) => {
      return new GetConfigError({
        _tag: 'parsed',
        errorCode: SCHEMA_VALIDATION_ERROR_CODE,
        reason: createSchemaValidationError(e.reason),
        message: formatErrors(e.error),
      })
    })
    .otherwise((e) => {
      debugErrorType(e)
      return new GetConfigError({ _tag: 'unparsed', message: e.error.message, reason: e.reason })
    })

  throw error
}

async function resolveBinaryTargets(generator: GeneratorConfig) {
  for (const binaryTarget of generator.binaryTargets) {
    // load the binaryTargets from the env var
    if (binaryTarget.fromEnvVar && process.env[binaryTarget.fromEnvVar]) {
      const value = JSON.parse(process.env[binaryTarget.fromEnvVar]!)

      if (Array.isArray(value)) {
        generator.binaryTargets = value.map((v) => ({ fromEnvVar: null, value: v }))
        await resolveBinaryTargets(generator) // resolve again if we have native
      } else {
        binaryTarget.value = value
      }
    }

    // resolve native to the current platform
    if (binaryTarget.value === 'native') {
      binaryTarget.value = await getBinaryTargetForCurrentPlatform()
      binaryTarget.native = true
    }
  }

  if (generator.binaryTargets.length === 0) {
    generator.binaryTargets = [{ fromEnvVar: null, value: await getBinaryTargetForCurrentPlatform(), native: true }]
  }
}

function formatErrors(errors: GetConfigValidationError[]) {
  const formattedErrors = errors.map((e) => relativizePathInPSLError(e.message)).join('\n\n')
  const errorCount = `Validation Error Count: ${errors.length}`
  return `${formattedErrors}\n${errorCount}`
}
