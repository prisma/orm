import Debug from '@prisma/debug'
import type { MultipleSchemas } from '@prisma/get-dmmf'

import { logger } from '..'
import { ErrorArea, getWasmError, RustPanic, WasmPanic } from '../panic'
import { prismaSchemaWasm } from '../wasm'
import { getLintWarningsAsText, lintSchema } from './lintSchema'

const debug = Debug('prisma:format')

type FormatSchemaParams = { schemas: MultipleSchemas }

export async function formatSchema(
  { schemas }: FormatSchemaParams,
  inputFormattingOptions?: Partial<DocumentFormattingParams['options']>,
): Promise<MultipleSchemas> {
  if (process.env.FORCE_PANIC_PRISMA_SCHEMA) {
    handleFormatPanic(() => {
      prismaSchemaWasm.debug_panic()
    })
  }

  const defaultFormattingOptions: DocumentFormattingParams['options'] = {
    tabSize: 2,
    insertSpaces: true,
  }

  const documentFormattingParams = {
    textDocument: { uri: 'file:/dev/null' },
    options: {
      ...defaultFormattingOptions,
      ...inputFormattingOptions,
    },
  } as DocumentFormattingParams

  /**
   * Note:
   * - Given an invalid schema, `formatWasm` returns a formatted schema regardless (when it doesn't panic).
   * - Given an invalid schema, `lintSchema` returns a list of warnings/errors regardless (when it doesn't panic).
   *   Warnings must be filtered out from the other diagnostics.
   * - Validation errors aren't checked/shown here.
   *   They appear when calling `getDmmf` on the formatted schema in Format.ts.
   *   If we called `getConfig` instead, we wouldn't have any validation check.
   */
  const { formattedMultipleSchemas, lintDiagnostics } = handleFormatPanic(() => {
    // the only possible error here is a Rust panic
    const formattedMultipleSchemasRaw = formatWasm(JSON.stringify(schemas), documentFormattingParams)
    const formattedMultipleSchemas = JSON.parse(formattedMultipleSchemasRaw) as MultipleSchemas

    const lintDiagnostics = lintSchema({ schemas: formattedMultipleSchemas })
    return { formattedMultipleSchemas, lintDiagnostics }
  })

  const lintWarnings = getLintWarningsAsText(lintDiagnostics)
  if (lintWarnings && logger.should.warn()) {
    // Output warnings to stderr
    console.warn(lintWarnings)
  }

  return Promise.resolve(formattedMultipleSchemas)
}

function handleFormatPanic<T>(tryCb: () => T) {
  try {
    return tryCb()
  } catch (e: unknown) {
    const { message, stack } = getWasmError(e as WasmPanic)
    debug(`Error formatting schema: ${message}`)
    debug(stack)

    const panic = new RustPanic(
      /* message */ message,
      /* rustStack */ stack,
      /* request */ '@prisma/prisma-schema-wasm format',
      ErrorArea.FMT_CLI,
    )

    throw panic
  }
}

type DocumentUri = string

type TextDocument = {
  /**
   * The associated URI for this document. Most documents have the __file__-scheme, indicating that they
   * represent files on disk. However, some documents may have other schemes indicating that they are not
   * available on disk.
   */
  readonly uri: DocumentUri
}

// Part of the LSP spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#documentFormattingParams
// These are only the parts we are interested in.
type DocumentFormattingParams = {
  textDocument: TextDocument
  options: {
    // this is the only property currently considered by Rust, the rest are ignored but are needed for successfully unmarshaling the `DocumentFormattingParams`
    // and be compatible with the LSP spec.
    // The Wasm formatter may fail silently on unmarshaling errors (a `warn!` macro is used in the Rust code, but that's not propagated to Wasm land).
    tabSize: number
    insertSpaces: boolean
  }
}

function formatWasm(schema: string, documentFormattingParams: DocumentFormattingParams): string {
  const formattedSchema = prismaSchemaWasm.format(schema, JSON.stringify(documentFormattingParams))
  return formattedSchema
}
