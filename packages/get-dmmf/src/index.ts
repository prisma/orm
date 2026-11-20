import { Debug } from '@prisma/debug'
import type * as DMMF from '@prisma/dmmf'
import prismaSchemaWasm from '@prisma/prisma-schema-wasm'
import { JSONParser } from '@streamparser/json'
import pluralize from 'pluralize'

const debug = Debug('prisma:getDMMF')

export type SingleSchema = string
export type MultipleSchemaTuple = [filename: string, content: string]
export type MultipleSchemas = Array<MultipleSchemaTuple>
export type SchemaFileInput = SingleSchema | MultipleSchemas

export type GetDMMFOptions = {
  datamodel: SchemaFileInput
}

export type GetDMMFError = {
  type: 'wasm-error' | 'parse-json'
  reason: string
  error: Error
}

/**
 * Wasm'd version of `getDMMF`.
 */
export function getDMMF(options: GetDMMFOptions): DMMF.Document | GetDMMFError {
  debug(`Using getDmmf Wasm`)

  const params = JSON.stringify({
    prismaSchema: options.datamodel,
    noColor: Boolean(process.env.NO_COLOR),
  })

  let data: string
  try {
    if (process.env.FORCE_PANIC_GET_DMMF) {
      debug('Triggering a Rust panic...')
      prismaSchemaWasm.debug_panic()
    }

    data = prismaSchemaWasm.get_dmmf(params)
  } catch (getDMMFErr) {
    if (isV8StringLimitError(getDMMFErr)) {
      debug('V8 string limit hit, falling back to buffered DMMF API')

      try {
        const data = getDMMFBuffered(params)
        debug('dmmf data retrieved via buffered API')
        return data
      } catch (getDMMFBufferedErr) {
        return {
          type: 'wasm-error',
          reason: '(get-dmmf buffered wasm)',
          error: getDMMFBufferedErr as Error,
        }
      }
    }

    return {
      type: 'wasm-error' as const,
      reason: '(get-dmmf wasm)',
      error: getDMMFErr as Error,
    }
  }

  try {
    const document = JSON.parse(data) as DMMF.Document
    debug('dmmf data retrieved without errors in getDmmf Wasm')
    return document
  } catch (err) {
    return {
      type: 'parse-json' as const,
      reason: 'Unable to parse JSON',
      error: err as Error,
    }
  }
}

export function getInternalDMMF(options: GetDMMFOptions): DMMF.Document | GetDMMFError {
  const result = getDMMF(options)
  if ('error' in result) {
    return result
  }
  return externalToInternalDmmf(result)
}

/**
 * Turns type: string into type: string[] for all args in order to support union input types
 * @param document
 */
export function externalToInternalDmmf(document: DMMF.Document): DMMF.Document {
  return {
    ...document,
    mappings: getMappings(document.mappings, document.datamodel),
  }
}

/**
 * Read DMMF from the handle-based buffered WASM API in chunks and parse via
 * chunked string decoding. This bypasses V8's string length limit by reading
 * the DMMF as Uint8Array chunks from a caller-owned DmmfBuffer handle.
 *
 * Requires `get_dmmf_buffered()` (returns a `DmmfBuffer` handle) from
 * `@prisma/prisma-schema-wasm`. The handle exposes `.len()`, `.read_chunk()`,
 * and `.free()` — no implicit global state.
 *
 * See: https://github.com/prisma/prisma/issues/29111
 */
function getDMMFBuffered(params: string): DMMF.Document | GetDMMFError {
  const CHUNK_SIZE = 16 * 1024 * 1024 // 16MB chunks — well under V8 string limit

  if (typeof prismaSchemaWasm.get_dmmf_buffered !== 'function') {
    return {
      type: 'wasm-error' as const,
      reason: '(get-dmmf-buffered wasm)',
      error: new Error(
        "Buffered DMMF API not available. It's required for schemas that do not fit within the default V8 memory limit. Ensure you are using latest @prisma/prisma-schema-wasm.",
      ),
    }
  }

  const buffer = prismaSchemaWasm.get_dmmf_buffered(params)

  try {
    const totalBytes = buffer.len()
    debug(`DMMF buffered: ${totalBytes} bytes (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`)

    // Use a streaming JSON parser that processes Uint8Array chunks directly,
    // never creating a single large string.
    const parser = new JSONParser()
    let result: DMMF.Document | undefined

    parser.onValue = ({ value, stack }) => {
      if (stack.length === 0 && value !== undefined) {
        result = value as unknown as DMMF.Document
      }
    }

    let offset = 0
    while (offset < totalBytes) {
      const len = Math.min(CHUNK_SIZE, totalBytes - offset)
      const chunk = buffer.read_chunk(offset, len)
      parser.write(chunk)
      offset += len
    }

    if (result === undefined) {
      return {
        type: 'parse-json' as const,
        reason: '(get-dmmf-buffered parse)',
        error: new Error('Streaming JSON parse produced no result'),
      }
    }

    debug(`DMMF parsed via streaming parser (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`)
    return result
  } finally {
    buffer.free()
  }
}

/**
 * Check if an error is the V8 string length limit.
 * V8 has a hard-coded limit of 0x1fffffe8 characters (~536MB) for strings.
 * No Node.js flags can change this.
 * See: https://github.com/prisma/prisma/issues/29111
 */
function isV8StringLimitError(error: unknown): error is Error & { code: 'ERR_STRING_TOO_LONG' } {
  return error instanceof Error && 'code' in error && error.code === 'ERR_STRING_TOO_LONG'
}

function getMappings(mappings: DMMF.Mappings, datamodel: DMMF.Datamodel): DMMF.Mappings {
  const modelOperations = mappings.modelOperations
    .filter((mapping) => {
      const model = datamodel.models.find((m) => m.name === mapping.model)
      if (!model) {
        throw new Error(`Mapping without model ${mapping.model}`)
      }
      return model.fields.some((f) => f.kind !== 'object')
    })
    // TODO most of this is probably not needed anymore
    .map((mapping: any) => ({
      model: mapping.model,
      plural: pluralize(uncapitalize(mapping.model)),
      findUnique: mapping.findUnique || mapping.findSingle,
      findUniqueOrThrow: mapping.findUniqueOrThrow,
      findFirst: mapping.findFirst,
      findFirstOrThrow: mapping.findFirstOrThrow,
      findMany: mapping.findMany,
      create: mapping.createOne || mapping.createSingle || mapping.create,
      createMany: mapping.createMany,
      createManyAndReturn: mapping.createManyAndReturn,
      delete: mapping.deleteOne || mapping.deleteSingle || mapping.delete,
      update: mapping.updateOne || mapping.updateSingle || mapping.update,
      deleteMany: mapping.deleteMany,
      updateMany: mapping.updateMany,
      updateManyAndReturn: mapping.updateManyAndReturn,
      upsert: mapping.upsertOne || mapping.upsertSingle || mapping.upsert,
      aggregate: mapping.aggregate,
      groupBy: mapping.groupBy,
      findRaw: mapping.findRaw,
      aggregateRaw: mapping.aggregateRaw,
    }))

  return {
    modelOperations,
    otherOperations: mappings.otherOperations,
  }
}

/**
 * Converts the first character of a word to lower case.
 */
export function uncapitalize<T extends string>(self: T): Uncapitalize<T> {
  return (self.substring(0, 1).toLowerCase() + self.substring(1)) as Uncapitalize<T>
}
