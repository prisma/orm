import Debug from '@prisma/debug'
import type * as DMMF from '@prisma/dmmf'
import type { DataSource, GeneratorConfig } from '@prisma/generator'
import { getDMMF as getDMMFRaw, getInternalDMMF as getInternalDMMFRaw, type SchemaFileInput } from '@prisma/get-dmmf'
import { bold, red } from 'kleur/colors'
import { match } from 'ts-pattern'

import { ErrorArea, getWasmError, isWasmPanic, RustPanic, WasmPanic } from '../panic'
import { assertNever } from '../utils/assertNever'
import { addVersionDetailsToErrorMessage } from './errorHelpers'
import { createDebugErrorType, parseQueryEngineError, QueryEngineErrorInit } from './queryEngineCommons'

export { externalToInternalDmmf } from '@prisma/get-dmmf'

const debug = Debug('prisma:getDMMF')
const debugErrorType = createDebugErrorType(debug, 'getDmmfWasm')

export interface ConfigMetaFormat {
  datasources: DataSource[]
  generators: GeneratorConfig[]
  warnings: string[]
}

export type GetDMMFOptions = {
  datamodel: SchemaFileInput
}

export class GetDmmfError extends Error {
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
[Context: getDmmf]`

    super(addVersionDetailsToErrorMessage(errorMessageWithContext))
    this.name = 'GetDmmfError'
  }
}

/**
 * Wasm'd version of `getDMMF`.
 */
export async function getDMMF(options: GetDMMFOptions): Promise<DMMF.Document> {
  return Promise.resolve(handleGetDmmfResult(getDMMFRaw(options)))
}

export async function getInternalDMMF(options: GetDMMFOptions): Promise<DMMF.Document> {
  return Promise.resolve(handleGetDmmfResult(getInternalDMMFRaw(options)))
}

function handleGetDmmfResult(result: ReturnType<typeof getDMMFRaw>): DMMF.Document {
  if ('error' in result) {
    debugErrorType(result)
    switch (result.type) {
      case 'wasm-error':
        throw mapWasmPanicToGetDmmfError(result.error, result.reason)
      case 'parse-json':
        throw new GetDmmfError({ _tag: 'unparsed', message: result.error.message, reason: result.reason })
      default:
        assertNever(result.type, 'Unknown getDmmf error type')
    }
  } else {
    return result
  }
}

function mapWasmPanicToGetDmmfError(error: Error | WasmPanic, reason: string): GetDmmfError {
  /**
   * Capture and propagate possible Wasm panics.
   */
  if (isWasmPanic(error)) {
    const { message, stack } = getWasmError(error)

    const panic = new RustPanic(
      /* message */ message,
      /* rustStack */ stack,
      /* request */ '@prisma/prisma-schema-wasm get_dmmf',
      ErrorArea.FMT_CLI,
    )
    return panic
  }

  /*
   * Extract the actual error by attempting to JSON-parse the error message.
   */
  const errorOutput = error.message
  return new GetDmmfError(parseQueryEngineError({ errorOutput, reason }))
}
