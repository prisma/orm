import { QueryCompiler, QueryCompilerConstructor, QueryEngineLogLevel } from '@prisma/client-common'
import {
  BatchResponse,
  convertCompactedRows,
  parameterizeBatch,
  parameterizeQuery,
  QueryEvent,
  QueryPlanNode,
  safeJsonStringify,
  TransactionInfo,
  UserFacingError,
} from '@prisma/client-engine-runtime'
import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
  PrismaClientUnknownRequestError,
} from '@prisma/client-runtime-utils'
import { Debug } from '@prisma/debug'
import type { IsolationLevel as SqlIsolationLevel, SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'
import type { ActiveConnectorType } from '@prisma/generator'
import type { TracingHelper } from '@prisma/instrumentation-contract'
import { assertNever } from '@prisma/internals'
import type { JsonBatchQuery, JsonQuery, RawJsonQuery } from '@prisma/json-protocol'
import { ParamGraph } from '@prisma/param-graph'

import { version as clientVersion } from '../../../../../package.json'
import { deserializeRawParameters } from '../../../utils/deserializeRawParameters'
import type { BatchQueryEngineResult, EngineConfig, RequestBatchOptions, RequestOptions } from '../common/Engine'
import { Engine } from '../common/Engine'
import { LogEmitter, QueryEvent as ClientQueryEvent } from '../common/types/Events'
import { RustRequestError, SyncRustError } from '../common/types/QueryEngine'
import type * as Tx from '../common/types/Transaction'
import { InteractiveTransactionInfo } from '../common/types/Transaction'
import { getBatchRequestPayload } from '../common/utils/getBatchRequestPayload'
import { getErrorMessageWithLink as genericGetErrorMessageWithLink } from '../common/utils/getErrorMessageWithLink'
import type { Executor } from './Executor'
import { isAllRawBatch } from './is-all-raw-batch'
import { LocalExecutor } from './LocalExecutor'
import { QueryPlanCache } from './query-plan-cache'
import { RemoteExecutor } from './RemoteExecutor'
import { QueryCompilerLoader } from './types/QueryCompiler'
import { wasmQueryCompilerLoader } from './WasmQueryCompilerLoader'

/**
 * Prisma error code for the `PrismaClientInitializationError` raised when
 * `PrismaClient` is instantiated without a driver adapter.
 */
const CLIENT_ENGINE_ERROR = 'P2038'

const debug = Debug('prisma:client:clientEngine')

type GlobalWithPanicHandler = typeof globalThis & {
  PRISMA_WASM_PANIC_REGISTRY: {
    set_message?: (message: string) => void
  }
}

const globalWithPanicHandler = globalThis as GlobalWithPanicHandler

// The fallback panic handler shared across all instances. This ensures that any
// panic is caught and handled, but each instance should prefer temporarily
// setting its own local panic handler for the duration of a synchronous WASM
// function call for better error messages.
globalWithPanicHandler.PRISMA_WASM_PANIC_REGISTRY = {
  set_message(message: string) {
    throw new PrismaClientRustPanicError(message, clientVersion)
  },
}

interface ConnectedEngine {
  executor: Executor
  queryCompiler: QueryCompiler
}

type EngineState =
  | {
      type: 'disconnected'
    }
  | {
      type: 'connecting'
      promise: Promise<ConnectedEngine>
    }
  | {
      type: 'connected'
      engine: ConnectedEngine
    }
  | {
      type: 'disconnecting'
      promise: Promise<void>
    }

type ExecutorKind =
  | {
      remote: false
      driverAdapterFactory: SqlDriverAdapterFactory
    }
  | {
      remote: true
      accelerateUrl: string
    }

export class ClientEngine implements Engine {
  name = 'ClientEngine' as const

  #QueryCompilerConstructor?: QueryCompilerConstructor
  #state: EngineState = { type: 'disconnected' }
  #queryCompilerLoader: QueryCompilerLoader
  #executorKind: ExecutorKind
  #queryPlanCache?: QueryPlanCache
  #paramGraph: ParamGraph

  config: EngineConfig
  datamodel: string

  logEmitter: LogEmitter
  logQueries: boolean
  logLevel: QueryEngineLogLevel
  tracingHelper: TracingHelper

  #emitQueryEvent?: (event: QueryEvent) => void

  constructor(config: EngineConfig, queryCompilerLoader?: QueryCompilerLoader) {
    if (config.accelerateUrl !== undefined) {
      this.#executorKind = { remote: true, accelerateUrl: config.accelerateUrl }
    } else if (config.adapter) {
      this.#executorKind = { remote: false, driverAdapterFactory: config.adapter }
      debug('Using driver adapter: %O', config.adapter)
    } else {
      throw new PrismaClientInitializationError(
        'PrismaClient requires a driver adapter to connect to your database, but none was provided. Pass one to the PrismaClient constructor, e.g. `new PrismaClient({ adapter })`. Learn more: https://pris.ly/d/driver-adapters',
        config.clientVersion,
        CLIENT_ENGINE_ERROR,
      )
    }

    if (TARGET_BUILD_TYPE === 'client' || TARGET_BUILD_TYPE === 'wasm-compiler-edge') {
      this.#queryCompilerLoader = queryCompilerLoader ?? wasmQueryCompilerLoader
    } else {
      throw new Error(`Invalid TARGET_BUILD_TYPE: ${TARGET_BUILD_TYPE}`)
    }

    this.config = config
    this.logQueries = config.logQueries ?? false
    this.logLevel = config.logLevel ?? 'error'
    this.logEmitter = config.logEmitter
    this.datamodel = config.inlineSchema
    this.tracingHelper = config.tracingHelper
    this.#queryPlanCache =
      config.queryPlanCacheMaxSize === 0 ? undefined : new QueryPlanCache(config.queryPlanCacheMaxSize)
    this.#paramGraph = ParamGraph.deserialize(config.parameterizationSchema, (enumName) => {
      if (!Object.hasOwn(config.runtimeDataModel.enums, enumName)) {
        return undefined
      }
      const mapping: Record<string, string> = {}
      for (const value of config.runtimeDataModel.enums[enumName].values) {
        mapping[value.name] = value.dbName ?? value.name
      }
      return mapping
    })

    if (config.enableDebugLogs) {
      this.logLevel = 'debug'
    }

    if (this.logQueries) {
      this.#emitQueryEvent = (event: QueryEvent) => {
        this.logEmitter.emit('query', {
          ...event,
          // TODO: we should probably change the interface to contain a proper array in the next major version.
          params: safeJsonStringify(event.params),
          // TODO: this field only exists for historical reasons as we grandfathered it from the time
          // when we emitted `tracing` events to stdout in the engine unchanged, and then described
          // them in the public API as TS types. Thus this field used to contain the name of the Rust
          // module in which an event originated. When using library engine, which uses a different
          // mechanism with a JavaScript callback for logs, it's normally just an empty string instead.
          // This field is definitely not useful and should be removed from the public types (but it's
          // technically a breaking change, even if a tiny and inconsequential one).
          target: 'ClientEngine',
        } satisfies ClientQueryEvent)
      }
    }
  }

  async #ensureStarted(): Promise<ConnectedEngine> {
    switch (this.#state.type) {
      case 'disconnected': {
        const connecting = this.tracingHelper.runInChildSpan('connect', async () => {
          let executor: Executor | undefined = undefined
          let queryCompiler: QueryCompiler | undefined = undefined

          try {
            executor = await this.#connectExecutor()
            queryCompiler = await this.#instantiateQueryCompiler(executor)
          } catch (error) {
            this.#state = { type: 'disconnected' }
            queryCompiler?.free()
            await executor?.disconnect()
            throw error
          }

          const engine: ConnectedEngine = {
            executor,
            queryCompiler,
          }

          this.#state = { type: 'connected', engine }

          return engine
        })

        this.#state = {
          type: 'connecting',
          promise: connecting,
        }

        return await connecting
      }

      case 'connecting':
        return await this.#state.promise

      case 'connected':
        return this.#state.engine

      case 'disconnecting':
        await this.#state.promise
        return await this.#ensureStarted()
    }
  }

  async #connectExecutor(): Promise<Executor> {
    if (this.#executorKind.remote) {
      return new RemoteExecutor({
        clientVersion: this.config.clientVersion,
        accelerateUrl: this.#executorKind.accelerateUrl,
        logEmitter: this.logEmitter,
        logLevel: this.logLevel,
        logQueries: this.logQueries,
        tracingHelper: this.tracingHelper,
        sqlCommenters: this.config.sqlCommenters,
      })
    } else {
      return await LocalExecutor.connect({
        driverAdapterFactory: this.#executorKind.driverAdapterFactory,
        tracingHelper: this.tracingHelper,
        transactionOptions: {
          ...this.config.transactionOptions,
          isolationLevel: this.#convertIsolationLevel(this.config.transactionOptions.isolationLevel),
        },
        onQuery: this.#emitQueryEvent,
        provider: this.config.activeProvider as ActiveConnectorType | undefined,
        sqlCommenters: this.config.sqlCommenters,
      })
    }
  }

  async #instantiateQueryCompiler(executor: Executor): Promise<QueryCompiler> {
    // We reuse the `QueryCompilerConstructor` from the same `WebAssembly.Instance` between
    // reconnects as long as there are no panics. This avoids the overhead of loading and
    // JIT compiling the WebAssembly module after every reconnect. If it panics, we discard
    // it and load a new one from scratch if the client reconnects again.
    let QueryCompilerConstructor = this.#QueryCompilerConstructor

    if (QueryCompilerConstructor === undefined) {
      QueryCompilerConstructor = await this.#queryCompilerLoader.loadQueryCompiler(this.config)
      this.#QueryCompilerConstructor = QueryCompilerConstructor
    }

    const { provider, connectionInfo } = await executor.getConnectionInfo()

    try {
      return this.#withLocalPanicHandler(
        () =>
          new QueryCompilerConstructor({
            datamodel: this.datamodel,
            provider,
            connectionInfo,
          }),
        undefined,
        false,
      )
    } catch (e) {
      throw this.#transformInitError(e)
    }
  }

  #transformInitError(err: Error): Error {
    if (err instanceof PrismaClientRustPanicError) {
      return err
    }
    try {
      const error: SyncRustError = JSON.parse(err.message)
      return new PrismaClientInitializationError(error.message, this.config.clientVersion, error.error_code)
    } catch (e) {
      return err
    }
  }

  #transformRequestError(err: any, query?: string): Error {
    if (err instanceof PrismaClientInitializationError) return err

    if (err.code === 'GenericFailure' && err.message?.startsWith('PANIC:'))
      return new PrismaClientRustPanicError(
        getErrorMessageWithLink(this, err.message, query),
        this.config.clientVersion,
      )

    if (err instanceof UserFacingError) {
      return new PrismaClientKnownRequestError(err.message, {
        code: err.code,
        meta: err.meta,
        clientVersion: this.config.clientVersion,
      })
    }

    try {
      const error: RustRequestError = JSON.parse(err as string)
      return new PrismaClientUnknownRequestError(`${error.message}\n${error.backtrace}`, {
        clientVersion: this.config.clientVersion,
      })
    } catch (e) {
      return err
    }
  }

  #transformCompileError(error: any): any {
    if (error instanceof PrismaClientRustPanicError) {
      return error
    }

    if (typeof error['message'] === 'string' && typeof error['code'] === 'string') {
      return new PrismaClientKnownRequestError(error['message'], {
        code: error['code'],
        meta: error.meta,
        clientVersion: this.config.clientVersion,
      })
    } else if (typeof error['message'] === 'string') {
      return new PrismaClientUnknownRequestError(error['message'], { clientVersion: this.config.clientVersion })
    } else {
      return error
    }
  }

  #withLocalPanicHandler<T>(fn: () => T, query?: string, disconnectOnPanic = true): T {
    const previousHandler = globalWithPanicHandler.PRISMA_WASM_PANIC_REGISTRY.set_message
    let panic: string | undefined = undefined

    global.PRISMA_WASM_PANIC_REGISTRY.set_message = (message: string) => {
      panic = message
    }

    try {
      return fn()
    } finally {
      global.PRISMA_WASM_PANIC_REGISTRY.set_message = previousHandler

      if (panic) {
        // Discard the current `WebAssembly.Instance` to avoid memory leaks:
        // WebAssembly doesn't unwind the stack or call destructors on panic.
        this.#QueryCompilerConstructor = undefined
        // Disconnect and drop the compiler, unless this panic happened during
        // initialization. In that case, we let `#ensureStarted` deal with it
        // and change the state to `disconnected` by itself.
        if (disconnectOnPanic) {
          void this.stop().catch((err) => debug('failed to disconnect:', err))
        }
        // eslint-disable-next-line no-unsafe-finally
        throw new PrismaClientRustPanicError(getErrorMessageWithLink(this, panic, query), this.config.clientVersion)
      }
    }
  }

  onBeforeExit() {
    throw new Error(
      '"beforeExit" hook is not applicable to the client engine, it is only relevant and implemented for the binary engine. Please add your event listener to the `process` object directly instead.',
    )
  }

  async start(): Promise<void> {
    await this.#ensureStarted()
  }

  async stop(): Promise<void> {
    switch (this.#state.type) {
      case 'disconnected':
        return

      case 'connecting':
        await this.#state.promise
        return await this.stop()

      case 'connected': {
        const engine = this.#state.engine

        const disconnecting = this.tracingHelper.runInChildSpan('disconnect', async () => {
          try {
            await engine.executor.disconnect()
            engine.queryCompiler.free()
          } finally {
            this.#state = { type: 'disconnected' }
          }
        })

        this.#state = {
          type: 'disconnecting',
          promise: disconnecting,
        }

        return await disconnecting
      }

      case 'disconnecting':
        return await this.#state.promise
    }
  }

  version(): string {
    return 'unknown'
  }

  async transaction(
    action: 'start',
    headers: Tx.TransactionHeaders,
    options: Tx.Options,
  ): Promise<Tx.InteractiveTransactionInfo>
  async transaction(
    action: 'commit',
    headers: Tx.TransactionHeaders,
    info: Tx.InteractiveTransactionInfo,
  ): Promise<undefined>
  async transaction(
    action: 'rollback',
    headers: Tx.TransactionHeaders,
    info: Tx.InteractiveTransactionInfo,
  ): Promise<undefined>
  async transaction(
    action: 'start' | 'commit' | 'rollback',
    _headers: Tx.TransactionHeaders,
    arg?: any,
  ): Promise<Tx.InteractiveTransactionInfo | undefined> {
    let result: TransactionInfo | undefined

    const { executor } = await this.#ensureStarted()

    try {
      if (action === 'start') {
        const options: Tx.Options = arg
        result = await executor.startTransaction({
          ...options,
          isolationLevel: this.#convertIsolationLevel(options.isolationLevel),
        })
      } else if (action === 'commit') {
        const txInfo: Tx.InteractiveTransactionInfo<undefined> = arg
        await executor.commitTransaction(txInfo)
      } else if (action === 'rollback') {
        const txInfo: Tx.InteractiveTransactionInfo<undefined> = arg
        await executor.rollbackTransaction(txInfo)
      } else {
        assertNever(action, 'Invalid transaction action.')
      }
    } catch (error) {
      throw this.#transformRequestError(error)
    }

    return result ? { id: result.id, payload: undefined } : undefined
  }

  async request<T>(
    query: JsonQuery,
    { interactiveTransaction, customDataProxyFetch }: RequestOptions<unknown>,
  ): Promise<{ data: T }> {
    debug(`sending request`)

    const { executor, queryCompiler } = await this.#ensureStarted().catch((err) => {
      throw this.#transformRequestError(err, JSON.stringify(query))
    })

    let plan: QueryPlanNode
    let placeholderValues: Record<string, unknown> = {}
    let queryInfoQuery = query.query

    if (isRawQuery(query)) {
      plan = compileRawQuery(query)
    } else {
      const { parameterizedQuery, placeholderValues: extractedValues } = parameterizeQuery(query, this.#paramGraph)
      const cacheKey = JSON.stringify(parameterizedQuery)
      placeholderValues = extractedValues
      queryInfoQuery = parameterizedQuery.query

      // We do not cache `createMany` and `createManyAndReturn` queries as they are very unlikely
      // to benefit from caching due to their high variability in parameters, which leads to a very
      // high cache miss rate and potential cache bloat.
      const isCacheable = query.action !== 'createMany' && query.action !== 'createManyAndReturn'
      const cached = isCacheable ? this.#queryPlanCache?.getSingle(cacheKey) : undefined
      if (cached) {
        debug('query plan cache hit')
        plan = cached
      } else {
        debug('query plan cache miss')
        plan = this.#compileQuery(parameterizedQuery, cacheKey, queryCompiler)
        if (isCacheable) {
          this.#queryPlanCache?.setSingle(cacheKey, plan)
        }
      }
    }

    try {
      debug(`query plan created`, plan)

      const result = await executor.execute({
        plan,
        model: query.modelName,
        operation: query.action,
        placeholderValues,
        transaction: interactiveTransaction,
        batchIndex: undefined,
        customFetch: customDataProxyFetch?.(globalThis.fetch),
        queryInfo: {
          type: 'single',
          modelName: query.modelName,
          action: query.action,
          query: queryInfoQuery,
        },
      })

      debug(`query plan executed`)

      return { data: { [query.action]: result } as T }
    } catch (e: any) {
      throw this.#transformRequestError(e, JSON.stringify(query))
    }
  }

  async requestBatch<T>(
    queries: JsonQuery[],
    { transaction, customDataProxyFetch }: RequestBatchOptions<unknown>,
  ): Promise<BatchQueryEngineResult<T>[]> {
    if (queries.length === 0) {
      return []
    }

    const firstAction = queries[0].action
    const firstModelName = queries[0].modelName

    const batchPayload = getBatchRequestPayload(queries, transaction)
    const request = JSON.stringify(batchPayload)

    const { executor, queryCompiler } = await this.#ensureStarted().catch((err) => {
      throw this.#transformRequestError(err, request)
    })

    const hasRawQueries = isAllRawBatch(queries)
    let batchResponse: BatchResponse
    let placeholderValues: Record<string, unknown> = {}
    let queryInfoQueries = queries.map((query) => query.query)

    if (!hasRawQueries) {
      const { parameterizedBatch, placeholderValues: extractedValues } = parameterizeBatch(
        batchPayload as JsonBatchQuery,
        this.#paramGraph,
      )
      const cacheKeyStr = JSON.stringify(parameterizedBatch)
      placeholderValues = extractedValues
      queryInfoQueries = parameterizedBatch.batch.map((query) => query.query)

      const cached = this.#queryPlanCache?.getBatch(cacheKeyStr)
      if (cached) {
        debug('batch query plan cache hit')
        batchResponse = cached
      } else {
        debug('batch query plan cache miss')
        try {
          batchResponse = this.#compileBatch(parameterizedBatch.batch, cacheKeyStr, queryCompiler)
          this.#queryPlanCache?.setBatch(cacheKeyStr, batchResponse)
        } catch (error) {
          throw this.#transformCompileError(error)
        }
      }
    } else {
      batchResponse = this.#compileBatch(queries, request, queryCompiler)
    }

    try {
      let txInfo: InteractiveTransactionInfo | undefined
      if (transaction?.kind === 'itx') {
        // If we are already in an interactive transaction we do not nest transactions
        txInfo = transaction.options
      }

      switch (batchResponse.type) {
        case 'multi': {
          if (transaction?.kind !== 'itx') {
            const batchOptions = transaction?.options
            const txOptions = {
              maxWait: batchOptions?.maxWait ?? this.config.transactionOptions.maxWait,
              timeout: batchOptions?.timeout ?? this.config.transactionOptions.timeout,
              isolationLevel: batchOptions?.isolationLevel ?? this.config.transactionOptions.isolationLevel,
            }
            txInfo = await this.transaction('start', {}, txOptions)
          }

          const results: BatchQueryEngineResult<unknown>[] = []
          let rollback = false
          let canContinueOnError: boolean | undefined
          for (const [batchIndex, plan] of batchResponse.plans.entries()) {
            try {
              const rows = await executor.execute({
                plan: plan as QueryPlanNode,
                placeholderValues,
                model: queries[batchIndex].modelName,
                operation: queries[batchIndex].action,
                batchIndex,
                transaction: txInfo,
                customFetch: customDataProxyFetch?.(globalThis.fetch) as typeof globalThis.fetch | undefined,
                queryInfo: {
                  type: 'single',
                  modelName: queries[batchIndex].modelName,
                  action: queries[batchIndex].action,
                  query: queryInfoQueries[batchIndex],
                },
              })
              results.push({ data: { [queries[batchIndex].action]: rows } })
            } catch (err) {
              canContinueOnError ??=
                transaction?.kind !== 'batch' &&
                queries.every((query) => query.action === 'findUnique' || query.action === 'findUniqueOrThrow')

              results.push(err as Error)
              rollback = true
              if (!canContinueOnError) {
                break
              }
            }
          }

          if (txInfo !== undefined && transaction?.kind !== 'itx') {
            if (rollback) {
              await this.transaction('rollback', {}, txInfo)
            } else {
              await this.transaction('commit', {}, txInfo)
            }
          }
          return results as BatchQueryEngineResult<T>[]
        }
        case 'compacted': {
          if (!queries.every((q) => q.action === firstAction && q.modelName === firstModelName)) {
            const actions = queries.map((q) => q.action).join(', ')
            const modelNames = queries.map((q) => q.modelName).join(', ')
            throw new Error(
              `Internal error: All queries in a compacted batch must have the same action and model name, but received actions: [${actions}] and model names: [${modelNames}]. ` +
                'This indicates a bug in the client. Please report this issue to the Prisma team with your query details.',
            )
          }

          if (firstModelName === undefined) {
            throw new Error(
              'Internal error: A compacted batch cannot contain raw queries. ' +
                'This indicates a bug in the client. Please report this issue to the Prisma team with your query details.',
            )
          }

          const rows = await executor.execute({
            plan: batchResponse.plan as QueryPlanNode,
            placeholderValues,
            model: firstModelName,
            operation: firstAction,
            batchIndex: undefined,
            transaction: txInfo,
            customFetch: customDataProxyFetch?.(globalThis.fetch) as typeof globalThis.fetch | undefined,
            queryInfo: {
              type: 'compacted',
              action: firstAction,
              modelName: firstModelName,
              queries: queryInfoQueries,
            },
          })

          const results = convertCompactedRows(rows as {}[], batchResponse, placeholderValues)
          return results.map((result) => ({ data: { [firstAction]: result } }) as BatchQueryEngineResult<T>)
        }
      }
    } catch (e: any) {
      throw this.#transformRequestError(e, request)
    }
  }

  /**
   * Used by `@prisma/extension-accelerate`
   */
  async apiKey(): Promise<string | null> {
    const { executor } = await this.#ensureStarted()
    return executor.apiKey()
  }

  #compileQuery(query: JsonQuery, request: string, compiler: QueryCompiler): QueryPlanNode {
    try {
      return this.#withLocalPanicHandler(() =>
        this.#withCompileSpan({
          queries: [query],
          execute: () => compiler.compile(request),
        }),
      )
    } catch (error) {
      throw this.#transformCompileError(error)
    }
  }

  #compileBatch(queries: JsonQuery[], request: string, compiler: QueryCompiler): BatchResponse {
    if (queries.every(isRawQuery)) {
      return {
        type: 'multi',
        plans: queries.map((q) => compileRawQuery(q)),
      }
    }

    try {
      return this.#withLocalPanicHandler(() =>
        this.#withCompileSpan({
          queries,
          execute: () => compiler.compileBatch(request),
        }),
      )
    } catch (err) {
      throw this.#transformCompileError(err)
    }
  }

  #convertIsolationLevel(clientIsolationLevel: Tx.IsolationLevel | undefined): SqlIsolationLevel | undefined {
    switch (clientIsolationLevel) {
      case undefined:
        return undefined
      case 'ReadUncommitted':
        return 'READ UNCOMMITTED'
      case 'ReadCommitted':
        return 'READ COMMITTED'
      case 'RepeatableRead':
        return 'REPEATABLE READ'
      case 'Serializable':
        return 'SERIALIZABLE'
      case 'Snapshot':
        return 'SNAPSHOT'
      default:
        throw new PrismaClientKnownRequestError(
          `Inconsistent column data: Conversion failed: Invalid isolation level \`${
            clientIsolationLevel satisfies never
          }\``,
          {
            code: 'P2023',
            clientVersion: this.config.clientVersion,
            meta: {
              providedIsolationLevel: clientIsolationLevel,
            },
          },
        )
    }
  }

  #withCompileSpan<T>({ queries, execute }: { queries: JsonQuery[]; execute: () => T }): T {
    return this.tracingHelper.runInChildSpan(
      {
        name: 'compile',
        attributes: {
          models: queries.map((q) => q.modelName).filter((m) => m !== undefined),
          actions: queries.map((q) => q.action),
        },
      },
      execute,
    )
  }
}

function getErrorMessageWithLink(engine: ClientEngine, title: string, query?: string) {
  return genericGetErrorMessageWithLink({
    binaryTarget: undefined,
    title,
    version: engine.config.clientVersion,
    engineVersion: 'unknown', // WASM engines do not export their version info
    database: engine.config.activeProvider as any,
    query,
  })
}

function isRawQuery(query: JsonQuery): query is RawJsonQuery {
  return query.action === 'queryRaw' || query.action === 'executeRaw'
}

function compileRawQuery(query: RawJsonQuery): QueryPlanNode {
  const sql = query.query.arguments.query
  const { args, argTypes } = deserializeRawParameters(query.query.arguments.parameters)
  return {
    type: query.action === 'queryRaw' ? 'query' : 'execute',
    args: { type: 'rawSql', sql, args, argTypes },
  }
}
