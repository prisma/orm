import { CompilerWasmLoadingConfig, RuntimeDataModel } from '@prisma/client-common'
import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'
import type { DataSource, GeneratorConfig } from '@prisma/generator'
import type { TracingHelper } from '@prisma/instrumentation-contract'
import type { JsonQuery } from '@prisma/json-protocol'
import type { SerializedParamGraph } from '@prisma/param-graph'
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'

import type { LogEmitter } from './types/Events'
import type { QueryEngineResultData } from './types/QueryEngine'
import type * as Transaction from './types/Transaction'

export type BatchTransactionOptions = {
  isolationLevel?: Transaction.IsolationLevel
  maxWait?: number
  timeout?: number
}

export type TransactionOptions<InteractiveTransactionPayload> =
  | {
      kind: 'itx'
      options: InteractiveTransactionOptions<InteractiveTransactionPayload>
    }
  | {
      kind: 'batch'
      options: BatchTransactionOptions
    }

export type InteractiveTransactionOptions<Payload> = Transaction.InteractiveTransactionInfo<Payload>

export type GraphQLQuery = {
  query: string
  variables: object
}

/**
 * A stripped down interface of `fetch` that `@prisma/extension-accelerate`
 * relies on. It must be in sync with the corresponding definition in the
 * Accelerate extension.
 *
 * This is the actual interface exposed by the extension. We can't use the
 * custom fetch function provided by it as normal fetch because the API is
 * different. Notably, `headers` must be an object and not a `Headers`
 * instance, and `url` must be a `string` and not a `URL`.
 *
 * The return type is `Response` but we can't specify this in an exported type
 * because it would end up referencing external types from `@types/node` or DOM
 * which can fail typechecking depending on TypeScript configuration in a user's
 * project.
 */
export type AccelerateExtensionFetch = (
  url: string,
  options: {
    body?: string
    method?: string
    headers: Record<string, string>
  },
) => Promise<unknown>

export type AccelerateExtensionFetchDecorator = (fetch: AccelerateExtensionFetch) => AccelerateExtensionFetch

export type RequestOptions<InteractiveTransactionPayload> = {
  traceparent?: string
  numTry?: number
  interactiveTransaction?: InteractiveTransactionOptions<InteractiveTransactionPayload>
  isWrite: boolean
  // only used by the data proxy engine
  customDataProxyFetch?: AccelerateExtensionFetchDecorator
}

export type RequestBatchOptions<InteractiveTransactionPayload> = {
  transaction?: TransactionOptions<InteractiveTransactionPayload>
  traceparent?: string
  numTry?: number
  containsWrite: boolean
  // only used by the data proxy engine
  customDataProxyFetch?: AccelerateExtensionFetchDecorator
}

export type BatchQueryEngineResult<T> = QueryEngineResultData<T> | Error

export interface Engine<InteractiveTransactionPayload = unknown> {
  /** The name of the engine. This is meant to be consumed externally */
  readonly name: string
  onBeforeExit(callback: () => Promise<void>): void
  start(): Promise<void>
  stop(): Promise<void>
  version(forceRun?: boolean): Promise<string> | string
  request<T>(
    query: JsonQuery,
    options: RequestOptions<InteractiveTransactionPayload>,
  ): Promise<QueryEngineResultData<T>>
  requestBatch<T>(
    queries: JsonQuery[],
    options: RequestBatchOptions<InteractiveTransactionPayload>,
  ): Promise<BatchQueryEngineResult<T>[]>
  transaction(
    action: 'start',
    headers: Transaction.TransactionHeaders,
    options: Transaction.Options,
  ): Promise<Transaction.InteractiveTransactionInfo<unknown>>
  transaction(
    action: 'commit',
    headers: Transaction.TransactionHeaders,
    info: Transaction.InteractiveTransactionInfo<unknown>,
  ): Promise<void>
  transaction(
    action: 'rollback',
    headers: Transaction.TransactionHeaders,
    info: Transaction.InteractiveTransactionInfo<unknown>,
  ): Promise<void>
}

export interface EngineConfig {
  enableDebugLogs?: boolean
  prismaPath?: string
  logQueries?: boolean
  logLevel?: 'info' | 'warn'
  clientVersion: string
  previewFeatures?: string[]
  activeProvider?: string
  logEmitter: LogEmitter
  transactionOptions: Transaction.Options

  /**
   * Instance of a Driver Adapter, e.g., like one provided by `@prisma/adapter-pg`.
   */
  adapter?: SqlDriverAdapterFactory

  /**
   * Prisma Accelerate URL allowing the client to connect through Accelerate instead of a direct database.
   */
  accelerateUrl?: string

  /**
   * The contents of the schema encoded into a string
   */
  inlineSchema: string

  /**
   * The helper for interaction with OTEL tracing
   * @remarks enabling is determined by the client and @prisma/instrumentation package
   */
  tracingHelper: TracingHelper

  /**
   * Web Assembly module loading configuration
   */
  compilerWasm?: CompilerWasmLoadingConfig

  /**
   * SQL commenter plugins that add metadata to SQL queries as comments.
   * Each plugin receives query context and returns key-value pairs.
   */
  sqlCommenters?: SqlCommenterPlugin[]

  /**
   * Parameterization schema (ParamGraph) for schema-aware query parameterization.
   * Enables precise parameterization based on DMMF metadata.
   */
  parameterizationSchema: SerializedParamGraph

  /**
   * Runtime data model for enum lookups during parameterization.
   */
  runtimeDataModel: RuntimeDataModel

  /**
   * Optional maximum size for the query plan cache. If not provided, a default size will be used.
   * A value of `0` can be used to disable the cache entirely. A higher cache size can improve
   * performance for applications that execute a large number of unique queries, while a smaller
   * cache size can reduce memory usage.
   */
  queryPlanCacheMaxSize?: number
}

/**
 * Used by `@prisma/extension-accelerate` until we migrate it to a better API.
 */
export interface AccelerateEngineConfig extends EngineConfig {
  /**
   * Allows Accelerate to use runtime utilities from the client. These are
   * necessary for `@prisma/extension-accelerate` to function correctly.
   * See <https://github.com/prisma/prisma-extension-accelerate/blob/b6ffa853f038780f5ab2fc01bff584ca251f645b/src/extension.ts#L518>
   */
  accelerateUtils: {
    resolveDatasourceUrl: () => string
  }
}

export type GetConfigResult = {
  datasources: DataSource[]
  generators: GeneratorConfig[]
}
