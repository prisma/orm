import { Context } from '@opentelemetry/api'
import { deserializeJsonObject } from '@prisma/client-engine-runtime'
import { hasBatchIndex } from '@prisma/client-runtime-utils'
import { Debug } from '@prisma/debug'
import { assertNever } from '@prisma/internals'
import stripAnsi from 'strip-ansi'

import {
  EngineValidationError,
  InteractiveTransactionOptions,
  JsonQuery,
  LogEmitter,
  TransactionOptions,
} from '../runtime/core/engines'
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
  PrismaClientUnknownRequestError,
} from '.'
import { AccelerateExtensionFetchDecorator } from './core/engines/common/Engine'
import { QueryEngineResultData } from './core/engines/common/types/QueryEngine'
import { throwValidationException } from './core/errorRendering/throwValidationException'
import { createApplyBatchExtensionsFunction } from './core/extensions/applyQueryExtensions'
import { MergedExtensionsList } from './core/extensions/MergedExtensionsList'
import { getBatchId } from './core/jsonProtocol/getBatchId'
import { isWrite } from './core/jsonProtocol/isWrite'
import { GlobalOmitOptions } from './core/jsonProtocol/serializeJsonQuery'
import { PrismaPromiseInteractiveTransaction, PrismaPromiseTransaction } from './core/request/PrismaPromise'
import { Action, JsArgs } from './core/types/exported/JsApi'
import { DataLoader } from './DataLoader'
import type { Client, Unpacker } from './getPrismaClient'
import { CallSite } from './utils/CallSite'
import { createErrorMessageWithContext } from './utils/createErrorMessageWithContext'
import { deepGet } from './utils/deep-set'
import { deserializeRawResult, RawResponse } from './utils/deserializeRawResults'
import { modelNameForTable } from './utils/modelNameForTable'

const debug = Debug('prisma:client:request_handler')

export type RequestParams = {
  modelName?: string
  action: Action
  protocolQuery: JsonQuery
  dataPath: string[]
  clientMethod: string
  callsite?: CallSite
  transaction?: PrismaPromiseTransaction
  extensions: MergedExtensionsList
  args?: any
  headers?: Record<string, string>
  unpacker?: Unpacker
  otelParentCtx?: Context
  otelChildCtx?: Context
  globalOmit?: GlobalOmitOptions
  customDataProxyFetch?: AccelerateExtensionFetchDecorator
}

export type HandleErrorParams = {
  args: JsArgs
  error: any
  clientMethod: string
  callsite?: CallSite
  transaction?: PrismaPromiseTransaction
  modelName?: string
  globalOmit?: GlobalOmitOptions
}

export class RequestHandler {
  client: Client
  dataloader: DataLoader<RequestParams>
  private logEmitter?: LogEmitter

  constructor(client: Client, logEmitter?: LogEmitter) {
    this.logEmitter = logEmitter
    this.client = client

    this.dataloader = new DataLoader({
      batchLoader: createApplyBatchExtensionsFunction(async ({ requests, customDataProxyFetch }) => {
        const { transaction, otelParentCtx } = requests[0]
        const queries = requests.map((r) => r.protocolQuery)
        const traceparent = this.client._tracingHelper.getTraceParent(otelParentCtx)

        // TODO: pass the child information to QE for it to issue links to queries
        // const links = requests.map((r) => trace.getSpanContext(r.otelChildCtx!))

        const containsWrite = requests.some((r) => isWrite(r.protocolQuery.action))

        const results = await this.client._engine.requestBatch(queries, {
          traceparent,
          transaction: getTransactionOptions(transaction),
          containsWrite,
          customDataProxyFetch,
        })

        return results.map((result, i) => {
          if (result instanceof Error) {
            return result
          }

          try {
            return this.mapQueryEngineResult(requests[i], result)
          } catch (error) {
            return error
          }
        })
      }),

      singleLoader: async (request) => {
        const interactiveTransaction =
          request.transaction?.kind === 'itx' ? getItxTransactionOptions(request.transaction) : undefined

        const response = await this.client._engine.request(request.protocolQuery, {
          traceparent: this.client._tracingHelper.getTraceParent(),
          interactiveTransaction,
          isWrite: isWrite(request.protocolQuery.action),
          customDataProxyFetch: request.customDataProxyFetch,
        })
        return this.mapQueryEngineResult(request, response)
      },

      batchBy: (request) => {
        // If the request is part of an interactive transaction, we want to group all requests with the same
        // protocolQuery together to take advantage of automatic batching in the engine.
        // Note that we only do this for interactive transactions, not for batch transactions, as it can lead to queries
        // being executed out of order in batch transactions.
        if (request.transaction?.kind === 'itx') {
          const batchId = getBatchId(request.protocolQuery)
          return `itx-${request.transaction.id}${batchId ? `-${batchId}` : ''}`
        }

        if (request.transaction?.id) {
          return `transaction-${request.transaction.id}`
        }

        return getBatchId(request.protocolQuery)
      },

      batchOrder(requestA, requestB) {
        if (requestA.transaction?.kind === 'batch' && requestB.transaction?.kind === 'batch') {
          return requestA.transaction.index - requestB.transaction.index
        }
        return 0
      },
    })
  }

  async request(params: RequestParams) {
    try {
      return await this.dataloader.request(params)
    } catch (error) {
      const { clientMethod, callsite, transaction, args, modelName } = params
      this.handleAndLogRequestError({
        error,
        clientMethod,
        callsite,
        transaction,
        args,
        modelName,
        globalOmit: params.globalOmit,
      })
    }
  }

  mapQueryEngineResult({ dataPath, unpacker }: RequestParams, response: QueryEngineResultData<any>) {
    const data = response?.data

    /**
     * Unpack
     */
    const result = this.unpack(data, dataPath, unpacker)
    if (process.env.PRISMA_CLIENT_GET_TIME) {
      return { data: result }
    }
    return result
  }

  /**
   * Handles the error and logs it, logging the error is done synchronously waiting for the event
   * handlers to finish.
   */
  handleAndLogRequestError(params: HandleErrorParams): never {
    try {
      this.handleRequestError(params)
    } catch (err) {
      if (this.logEmitter) {
        this.logEmitter.emit('error', { message: err.message, target: params.clientMethod, timestamp: new Date() })
      }
      throw err
    }
  }

  handleRequestError({
    error,
    clientMethod,
    callsite,
    transaction,
    args,
    modelName,
    globalOmit,
  }: HandleErrorParams): never {
    debug(error)

    if (isMismatchingBatchIndex(error, transaction)) {
      // if this is batch error and current request was not it's cause, we don't add
      // context information to the error: this wasn't a request that caused batch to fail
      throw error
    }

    if (error instanceof PrismaClientKnownRequestError && isValidationError(error)) {
      const validationError = convertValidationError(error.meta as EngineValidationError)
      throwValidationException({
        args,
        errors: [validationError],
        callsite,
        errorFormat: this.client._errorFormat,
        originalMethod: clientMethod,
        clientVersion: this.client._clientVersion,
        globalOmit,
      })
    }

    let message = error.message
    if (callsite) {
      message = createErrorMessageWithContext({
        callsite,
        originalMethod: clientMethod,
        isPanic: error.isPanic,
        showColors: this.client._errorFormat === 'pretty',
        message,
      })
    }

    message = this.sanitizeMessage(message)
    // TODO: Do request with callsite instead, so we don't need to rethrow
    if (error.code) {
      const meta = this.resolveErrorMeta(error.meta, error.code, modelName)
      throw new PrismaClientKnownRequestError(message, {
        code: error.code,
        clientVersion: this.client._clientVersion,
        meta,
        batchRequestIdx: error.batchRequestIdx,
      })
    } else if (error.isPanic) {
      throw new PrismaClientRustPanicError(message, this.client._clientVersion)
    } else if (error instanceof PrismaClientUnknownRequestError) {
      throw new PrismaClientUnknownRequestError(message, {
        clientVersion: this.client._clientVersion,
        batchRequestIdx: error.batchRequestIdx,
      })
    } else if (error instanceof PrismaClientInitializationError) {
      throw new PrismaClientInitializationError(message, this.client._clientVersion)
    } else if (error instanceof PrismaClientRustPanicError) {
      throw new PrismaClientRustPanicError(message, this.client._clientVersion)
    }

    error.clientVersion = this.client._clientVersion

    throw error
  }

  /**
   * Builds the `meta` object for a `PrismaClientKnownRequestError`.
   *
   * P2002 errors carry the physical name of the table the violated constraint
   * belongs to (`meta.table`, extracted by the driver adapters). It is mapped
   * back to the Prisma model name so that `meta.modelName` points at the model
   * where the violation actually occurred — which for nested writes is not
   * necessarily the model of the top-level operation — and the internal
   * `table` key is dropped from the user-facing meta.
   */
  private resolveErrorMeta(
    errorMeta: Record<string, unknown> | undefined,
    errorCode: string,
    topLevelModelName: string | undefined,
  ): Record<string, unknown> | undefined {
    if (errorCode !== 'P2002' || typeof errorMeta?.table !== 'string') {
      return topLevelModelName ? { modelName: topLevelModelName, ...errorMeta } : errorMeta
    }

    const meta: Record<string, unknown> = { ...errorMeta }
    delete meta.table

    const modelName =
      modelNameForTable(this.client._runtimeDataModel, errorMeta.table) ??
      (typeof meta.modelName === 'string' ? meta.modelName : topLevelModelName)

    return modelName !== undefined ? { ...meta, modelName } : meta
  }

  sanitizeMessage(message) {
    if (this.client._errorFormat && this.client._errorFormat !== 'pretty') {
      return stripAnsi(message)
    }
    return message
  }

  unpack(data: unknown, dataPath: string[], unpacker?: Unpacker) {
    if (!data) {
      return data
    }
    if (data['data']) {
      data = data['data']
    }

    if (!data) {
      return data
    }
    const operation = Object.keys(data)[0]
    const response = Object.values(data)[0]
    const pathForGet = dataPathToGetPath(dataPath)
    const extractedResponse = deepGet(response, pathForGet)
    const deserializedResponse =
      operation === 'queryRaw'
        ? deserializeRawResult(extractedResponse as RawResponse)
        : (deserializeJsonObject(extractedResponse) as unknown)

    return unpacker ? unpacker(deserializedResponse) : deserializedResponse
  }

  get [Symbol.toStringTag]() {
    return 'RequestHandler'
  }
}

function getTransactionOptions<PayloadType>(
  transaction?: PrismaPromiseTransaction<PayloadType>,
): TransactionOptions<PayloadType> | undefined {
  if (!transaction) {
    return undefined
  }

  if (transaction.kind === 'batch') {
    return {
      kind: 'batch',
      options: {
        isolationLevel: transaction.isolationLevel,
        maxWait: transaction.maxWait,
        timeout: transaction.timeout,
      },
    }
  }

  if (transaction.kind === 'itx') {
    return {
      kind: 'itx',
      options: getItxTransactionOptions(transaction),
    }
  }

  assertNever(transaction, 'Unknown transaction kind')
}

function getItxTransactionOptions<PayloadType>(
  transaction: PrismaPromiseInteractiveTransaction<PayloadType>,
): InteractiveTransactionOptions<PayloadType> {
  return {
    id: transaction.id,
    payload: transaction.payload,
  }
}

function isMismatchingBatchIndex(error: any, transaction: PrismaPromiseTransaction | undefined) {
  return hasBatchIndex(error) && transaction?.kind === 'batch' && error.batchRequestIdx !== transaction.index
}

function isValidationError(error: PrismaClientKnownRequestError) {
  return (
    error.code === 'P2009' || // validation error
    error.code === 'P2012' // required argument missing
  )
}

/**
 * Engine validation errors include extra segment for selectionPath - root query field.
 * This function removes it (since it does not exist on js arguments). In case of `Union`
 * error type, removes heading element from selectionPath of nested errors as well.
 * @param error
 * @returns
 */
function convertValidationError(error: EngineValidationError): EngineValidationError {
  if (error.kind === 'Union') {
    return {
      kind: 'Union',
      errors: error.errors.map(convertValidationError),
    }
  }

  if (Array.isArray(error['selectionPath'])) {
    const [, ...selectionPath] = error['selectionPath']

    return {
      ...error,
      selectionPath,
    } as EngineValidationError
  }

  return error
}

/**
 * Converts a fluent-API dataPath into the path used to read the result out of
 * the response. dataPath is a sequence of [selector, relationField] pairs where
 * the selector is always 'select' or 'include'. The relation field names (the
 * odd positions) form the path. Filtering by the literal values 'select' or
 * 'include' would also drop a relation field that happens to be named that way,
 * so the path is derived positionally instead.
 */
export function dataPathToGetPath(dataPath: string[]): string[] {
  const getPath: string[] = []
  for (let index = 1; index < dataPath.length; index += 2) {
    getPath.push(dataPath[index])
  }
  return getPath
}
