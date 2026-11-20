import Debug from '@prisma/debug'
import type { MultipleSchemas } from '@prisma/get-dmmf'
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/lib/function'
import { bold, red } from 'kleur/colors'
import { match } from 'ts-pattern'

import { ErrorArea, getWasmError, isWasmPanic, RustPanic, WasmPanic } from '../panic'
import { prismaSchemaWasm } from '../wasm'
import { addVersionDetailsToErrorMessage } from './errorHelpers'
import { createDebugErrorType, parseQueryEngineError, QueryEngineErrorInit } from './queryEngineCommons'
import { relativizePathInPSLError } from './relativizePathInPSLError'

const debug = Debug('prisma:mergeSchemas')

export type MergeSchemasOptions = {
  schemas: MultipleSchemas
}

export class MergeSchemasError extends Error {
  constructor(params: QueryEngineErrorInit) {
    const constructedErrorMessage = match(params)
      .with({ _tag: 'parsed' }, ({ errorCode, message, reason }) => {
        const errorCodeMessage = errorCode ? `Error code: ${errorCode}` : ''
        return `${reason}
${errorCodeMessage}
${relativizePathInPSLError(message)}`
      })
      .with({ _tag: 'unparsed' }, ({ message, reason }) => {
        const detailsHeader = red(bold('Details:'))
        return `${reason}
${detailsHeader} ${message}`
      })
      .exhaustive()
    const errorMessageWithContext = `${constructedErrorMessage}
[Context: mergeSchemas]`

    super(addVersionDetailsToErrorMessage(errorMessageWithContext))
    this.name = 'MergeSchemasError'
  }
}

/**
 * Wasm'd version of `merge_schemas`.
 */
export function mergeSchemas(options: MergeSchemasOptions): string {
  const debugErrorType = createDebugErrorType(debug, 'mergeSchemasWasm')
  debug(`Using mergeSchemas Wasm`)

  const mergeSchemasEither = pipe(
    E.tryCatch(
      () => {
        const params = JSON.stringify({
          schema: options.schemas,
        })
        return prismaSchemaWasm.merge_schemas(params)
      },
      (e) =>
        ({
          type: 'wasm-error' as const,
          reason: '(mergeSchemas wasm)',
          error: e as Error | WasmPanic,
        }) as const,
    ),
  )

  if (E.isRight(mergeSchemasEither)) {
    return mergeSchemasEither.right
  }

  /**
   * Check which error to throw.
   */
  const error = match(mergeSchemasEither.left)
    .with({ type: 'wasm-error' }, (e) => {
      debugErrorType(e)

      console.error('') // empty line for better readability

      /**
       * Capture and propagate possible Wasm panics.
       */
      if (isWasmPanic(e.error)) {
        const { message, stack } = getWasmError(e.error)
        debug(`Error merging schemas: ${message}`)
        debug(stack)

        const panic = new RustPanic(
          /* message */ message,
          /* rustStack */ stack,
          /* request */ '@prisma/prisma-schema-wasm merge_schemas',
          ErrorArea.FMT_CLI,
        )
        return panic
      }

      /*
       * Extract the actual error by attempting to JSON-parse the error message.
       */
      const errorOutput = e.error.message
      return new MergeSchemasError(parseQueryEngineError({ errorOutput, reason: e.reason }))
    })
    .exhaustive()

  throw error
}
