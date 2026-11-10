import type { Context } from '@opentelemetry/api'
import { GetPrismaClientConfig, RuntimeDataModel } from '@prisma/client-common'
import { RawValue, Sql } from '@prisma/client-runtime-utils'
import { clearLogs, Debug } from '@prisma/debug'
import type { SqlDriverAdapterFactory } from '@prisma/driver-adapter-utils'
import type { ExtendedSpanOptions, TracingHelper } from '@prisma/instrumentation-contract'
import { logger } from '@prisma/internals'
import type { SqlCommenterPlugin } from '@prisma/sqlcommenter'
import { AsyncResource } from 'async_hooks'
import { EventEmitter } from 'events'

import { PrismaClientInitializationError, PrismaClientValidationError } from '.'
import { addProperty, createCompositeProxy, removeProperties } from './core/compositeProxy'
import { BatchTransactionOptions, Engine, EngineConfig, Options } from './core/engines'
import { AccelerateEngineConfig, AccelerateExtensionFetchDecorator } from './core/engines/common/Engine'
import { EngineEvent, LogEmitter } from './core/engines/common/types/Events'
import type * as Transaction from './core/engines/common/types/Transaction'
import { prettyPrintArguments } from './core/errorRendering/prettyPrintArguments'
import { $extends } from './core/extensions/$extends'
import { applyAllResultExtensions } from './core/extensions/applyAllResultExtensions'
import { applyQueryExtensions } from './core/extensions/applyQueryExtensions'
import { MergedExtensionsList } from './core/extensions/MergedExtensionsList'
import { resolveResultExtensionContext } from './core/extensions/resolve-result-extension-context'
import { getEngineInstance } from './core/init/getEngineInstance'
import { GlobalOmitOptions, serializeJsonQuery } from './core/jsonProtocol/serializeJsonQuery'
import {
  applyModelsAndClientExtensions,
  unApplyModelsAndClientExtensions,
} from './core/model/applyModelsAndClientExtensions'
import { rawCommandArgsMapper } from './core/raw-query/rawCommandArgsMapper'
import {
  checkAlter,
  rawQueryArgsMapper,
  sqlMiddlewareArgsMapper,
  templateStringMiddlewareArgsMapper,
} from './core/raw-query/rawQueryArgsMapper'
import { createPrismaPromiseFactory } from './core/request/createPrismaPromise'
import {
  PrismaPromise,
  PrismaPromiseInteractiveTransaction,
  PrismaPromiseTransaction,
} from './core/request/PrismaPromise'
import { UserArgs } from './core/request/UserArgs'
import { getTracingHelper } from './core/tracing/TracingHelper'
import { getLockCountPromise } from './core/transaction/utils/createLockCountPromise'
import { itxClientDenyList } from './core/types/exported/itxClientDenyList'
import { JsInputValue } from './core/types/exported/JsApi'
import { RawQueryArgs } from './core/types/exported/RawQueryArgs'
import { UnknownTypedSql } from './core/types/exported/TypedSql'
import { getLogLevel } from './getLogLevel'
import type { QueryMiddlewareParams } from './QueryMiddlewareParams'
import { RequestHandler } from './RequestHandler'
import { CallSite, getCallSite } from './utils/CallSite'
import { clientVersion } from './utils/clientVersion'
import { validatePrismaClientOptions } from './utils/validatePrismaClientOptions'
import { waitForBatch } from './utils/waitForBatch'

const debug = Debug('prisma:client')

declare global {
  // eslint-disable-next-line no-var
  var NODE_CLIENT: true
  const TARGET_BUILD_TYPE: 'wasm-compiler-edge' | 'client'
}

// used by esbuild for tree-shaking
typeof globalThis === 'object' ? (globalThis.NODE_CLIENT = true) : 0

export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'

/**
 * Options common to all variants of `PrismaClientOptions`, regardless of
 * whether you connect to your database through a driver adapter or through
 * Prisma Accelerate.
 */
export interface PrismaClientBaseOptions {
  /**
   * @default "colorless"
   */
  errorFormat?: ErrorFormat

  /**
   * The default values for Transaction options
   * maxWait ?= 2000
   * timeout ?= 5000
   */
  transactionOptions?: Transaction.Options

  /**
   * @example
   * \`\`\`
   * // Defaults to stdout
   * log: ['query', 'info', 'warn']
   *
   * // Emit as events
   * log: [
   *  { emit: 'stdout', level: 'query' },
   *  { emit: 'stdout', level: 'info' },
   *  { emit: 'stdout', level: 'warn' }
   * ]
   * \`\`\`
   * Read more in our [docs](https://pris.ly/d/logging).
   */
  log?: Array<LogLevel | LogDefinition>

  omit?: GlobalOmitOptions

  /**
   * SQL commenter plugins that add metadata to SQL queries as comments.
   * Comments follow the sqlcommenter format: https://google.github.io/sqlcommenter/
   *
   * @example
   * ```ts
   * new PrismaClient({
   *   adapter: new PrismaPg({ connectionString }),
   *   comments: [
   *     traceContext(),
   *     queryInsights(),
   *   ],
   * })
   * ```
   */
  comments?: SqlCommenterPlugin[]

  /**
   * Optional maximum size for the query plan cache. If not provided, a default size will be used.
   * A value of `0` can be used to disable the cache entirely. A higher cache size can improve
   * performance for applications that execute a large number of unique queries, while a smaller
   * cache size can reduce memory usage.
   *
   * @example
   * ```
   * const prisma = new PrismaClient({
   *   adapter,
   *   queryPlanCacheMaxSize: 100,
   * })
   * ```
   */
  queryPlanCacheMaxSize?: number

  /**
   * @internal
   * You probably don't want to use this. \`__internal\` is used by internal tooling.
   */
  __internal?: {
    debug?: boolean
    /** This can be used for testing purposes */
    configOverride?: (config: GetPrismaClientConfig) => GetPrismaClientConfig
  }
}

// NOTE: `PrismaClientOptionsWithAccelerateUrl` is intentionally declared before
// `PrismaClientOptionsWithAdapter`, and `PrismaClientOptions` lists them in
// the same order in its union. TypeScript's missing-property error elaboration
// for a discriminated union reports against the *second* union member, so the
// adapter branch must come second to make `new PrismaClient({ log: [...] })`
// say "adapter is missing" (the recommended option for most users) rather than
// "accelerateUrl is missing". The generated client mirrors this order in
// `prismaNamespace.ts`.

/**
 * `PrismaClient` options for connecting to your database through Prisma
 * Accelerate instead of a driver adapter.
 *
 * Learn more: https://pris.ly/d/accelerate
 */
export interface PrismaClientOptionsWithAccelerateUrl extends PrismaClientBaseOptions {
  /**
   * The Prisma Accelerate connection URL. Use this option to connect to
   * your database through Prisma Accelerate instead of using a driver
   * adapter to connect directly.
   *
   * Learn more: https://pris.ly/d/accelerate
   */
  accelerateUrl: string
  adapter?: never
}

/**
 * `PrismaClient` options for connecting to your database through a driver
 * adapter. This is the common case in Prisma 7.
 *
 * Learn more: https://pris.ly/d/driver-adapters
 */
export interface PrismaClientOptionsWithAdapter extends PrismaClientBaseOptions {
  /**
   * A driver adapter that PrismaClient uses to connect to your database,
   * such as the ones provided by `@prisma/adapter-pg`,
   * `@prisma/adapter-libsql`, `@prisma/adapter-planetscale`, etc.
   *
   * A driver adapter is **required** unless you connect to your database
   * through Prisma Accelerate (in which case use `accelerateUrl` instead).
   *
   * Learn more: https://pris.ly/d/driver-adapters
   *
   * @example
   * ```ts
   * import { PrismaPg } from '@prisma/adapter-pg'
   * import { PrismaClient } from './generated/prisma/client'
   *
   * const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
   * const prisma = new PrismaClient({ adapter })
   * ```
   */
  adapter: SqlDriverAdapterFactory
  accelerateUrl?: never
}

/**
 * Options passed to the `PrismaClient` constructor.
 *
 * A driver adapter (or, alternatively, a Prisma Accelerate URL) is **required**.
 * See {@link PrismaClientOptionsWithAdapter} and
 * {@link PrismaClientOptionsWithAccelerateUrl} for the two variants. All other
 * properties live in {@link PrismaClientBaseOptions} and are optional.
 *
 * Learn more about driver adapters: https://pris.ly/d/driver-adapters
 */
export type PrismaClientOptions = PrismaClientOptionsWithAccelerateUrl | PrismaClientOptionsWithAdapter

export type Unpacker = (data: any) => any

export type InternalRequestParams = {
  /**
   * The original client method being called.
   * Even though the rootField / operation can be changed,
   * this method stays as it is, as it's what the user's
   * code looks like
   */
  clientMethod: string // TODO what is this
  /**
   * Name of js model that triggered the request. Might be used
   * for warnings or error messages
   */
  jsModelName?: string
  // Extra headers for data proxy.
  callsite?: CallSite
  transaction?: PrismaPromiseTransaction
  unpacker?: Unpacker // TODO what is this
  otelParentCtx?: Context
  /** Used to "desugar" a user input into an "expanded" one */
  argsMapper?: (args?: UserArgs) => UserArgs

  /** Used to convert args for middleware and back */
  middlewareArgsMapper?: MiddlewareArgsMapper<unknown, unknown>
  /** Used for Accelerate client extension via Data Proxy */
  customDataProxyFetch?: AccelerateExtensionFetchDecorator
} & Omit<QueryMiddlewareParams, 'runInTransaction'>

export type MiddlewareArgsMapper<RequestArgs, MiddlewareArgs> = {
  requestArgsToMiddlewareArgs(requestArgs: RequestArgs): MiddlewareArgs
  middlewareArgsToRequestArgs(middlewareArgs: MiddlewareArgs): RequestArgs
}

const noopMiddlewareArgsMapper: MiddlewareArgsMapper<unknown, unknown> = {
  requestArgsToMiddlewareArgs: (param) => param,
  middlewareArgsToRequestArgs: (param) => param,
}

/* Types for Logging */
export type LogLevel = 'info' | 'query' | 'warn' | 'error'
export type LogDefinition = {
  level: LogLevel
  emit: 'stdout' | 'event'
}

export type QueryEvent = {
  timestamp: Date
  query: string
  params: string
  duration: number
  target: string
}

export type LogEvent = {
  timestamp: Date
  message: string
  target: string
}
/* End Types for Logging */

type ExtendedEventType = LogLevel | 'beforeExit'
type EventCallback<E extends ExtendedEventType> = [E] extends ['beforeExit']
  ? () => Promise<void>
  : [E] extends [LogLevel]
    ? (event: EngineEvent<E>) => void
    : never

const TX_SCOPE_CONTEXT = Symbol.for('prisma.client.transaction.scope_context')

type ItxScopeState = {
  stack: string[]
}

type TopLevelItxScopeContext = {
  kind: 'top-level'
}

type NestedItxScopeContext = {
  kind: 'nested'
  txId: string
  scopeId: string
  scopeState: ItxScopeState
}

type ItxScopeContext = TopLevelItxScopeContext | NestedItxScopeContext

function getItxScopeContext(client: object): ItxScopeContext {
  const symbolStorage = client as Record<symbol, unknown>
  const context = symbolStorage[TX_SCOPE_CONTEXT]

  if (context === undefined) {
    return { kind: 'top-level' }
  }

  if (isNestedItxScopeContext(context)) {
    return context
  }

  throw new Error('Internal error: inconsistent transaction scope context.')
}

function isNestedItxScopeContext(value: unknown): value is NestedItxScopeContext {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const objectValue = value as Record<string, unknown>
  return (
    objectValue['kind'] === 'nested' &&
    typeof objectValue['txId'] === 'string' &&
    typeof objectValue['scopeId'] === 'string' &&
    isItxScopeState(objectValue['scopeState'])
  )
}

function isItxScopeState(value: unknown): value is ItxScopeState {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return Array.isArray(value['stack'])
}

function createItxScopeId(): string {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const BatchTxIdCounter = {
  id: 0,
  nextId() {
    return ++this.id
  },
}

export type Client =
  ReturnType<typeof getPrismaClient> extends new (optionsArg: PrismaClientOptions) => infer T ? T : never

export function getPrismaClient(config: GetPrismaClientConfig) {
  class PrismaClient {
    _originalClient = this
    _runtimeDataModel: RuntimeDataModel
    _requestHandler: RequestHandler
    _connectionPromise?: Promise<any>
    _disconnectionPromise?: Promise<any>
    _engineConfig: EngineConfig
    _accelerateEngineConfig: AccelerateEngineConfig
    _clientVersion: string
    _errorFormat: ErrorFormat
    _tracingHelper: TracingHelper
    _previewFeatures: string[]
    _activeProvider: string
    _globalOmit?: GlobalOmitOptions
    _extensions: MergedExtensionsList
    /**
     * @remarks This is used internally by Policy, do not rename or remove
     */
    _engine: Engine
    /**
     * A fully constructed/applied Client that references the parent
     * PrismaClient. This is used for Client extensions only.
     */
    _appliedParent: PrismaClient
    _createPrismaPromise = createPrismaPromiseFactory()

    constructor(optionsArg: PrismaClientOptions) {
      if (!optionsArg) {
        throw new PrismaClientInitializationError(
          `\
PrismaClient was instantiated without any options. A driver adapter is required to connect to your database.

Pass a driver adapter to the PrismaClient constructor, for example:

  import { PrismaPg } from '@prisma/adapter-pg'
  import { PrismaClient } from './generated/prisma/client'

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })

Learn more about driver adapters: https://pris.ly/d/driver-adapters

If you use Prisma Accelerate instead of connecting to your database directly, pass \`accelerateUrl\` to the PrismaClient constructor instead of \`adapter\`.`,
          clientVersion,
        )
      }
      config = optionsArg.__internal?.configOverride?.(config) ?? config
      validatePrismaClientOptions(optionsArg, config)

      // prevents unhandled error events when users do not explicitly listen to them
      const logEmitter = new EventEmitter().on('error', () => {}) as LogEmitter

      this._extensions = MergedExtensionsList.empty()
      this._previewFeatures = config.previewFeatures
      this._clientVersion = config.clientVersion ?? clientVersion
      this._activeProvider = config.activeProvider
      this._globalOmit = optionsArg?.omit
      this._tracingHelper = getTracingHelper()

      /**
       * Initialise and validate the Driver Adapter, if provided.
       */

      let adapter: SqlDriverAdapterFactory | undefined
      if (optionsArg.adapter) {
        adapter = optionsArg.adapter

        // Note:
        // - `getConfig(..).datasources[0].provider` can be `postgresql`, `postgres`, `mysql`, or other known providers
        // - `getConfig(..).datasources[0].activeProvider`, stored in `config.activeProvider`, can be `postgresql`, `mysql`, or other known providers
        // - `adapter.provider` can be `postgres`, `mysql`, or `sqlite`, and changing this requires changes to Rust as well,
        //    see https://github.com/prisma/prisma-engines/blob/d116c37d7d27aee74fdd840fc85ab2b45407e5ce/query-engine/driver-adapters/src/types.rs#L22-L23.
        //
        // TODO: Normalize these provider names once and for all in Prisma 6.
        const expectedDriverAdapterProvider =
          config.activeProvider === 'postgresql'
            ? 'postgres'
            : // CockroachDB is only accessible through Postgres driver adapters
              config.activeProvider === 'cockroachdb'
              ? 'postgres'
              : config.activeProvider

        if (adapter.provider !== expectedDriverAdapterProvider) {
          throw new PrismaClientInitializationError(
            `The Driver Adapter \`${adapter.adapterName}\`, based on \`${adapter.provider}\`, is not compatible with the provider \`${expectedDriverAdapterProvider}\` specified in the Prisma schema.`,
            this._clientVersion,
          )
        }
      }

      try {
        const options: PrismaClientOptions = optionsArg ?? {}
        const internal = options.__internal ?? {}

        const useDebug = internal.debug === true
        if (useDebug) {
          Debug.enable('prisma:client')
        }

        if (options.errorFormat) {
          this._errorFormat = options.errorFormat
        } else if (process.env.NODE_ENV === 'production') {
          this._errorFormat = 'minimal'
        } else if (process.env.NO_COLOR) {
          this._errorFormat = 'colorless'
        } else {
          this._errorFormat = 'colorless' // default errorFormat
        }

        this._runtimeDataModel = config.runtimeDataModel

        this._engineConfig = {
          enableDebugLogs: useDebug,
          logLevel: options.log && (getLogLevel(options.log) as any), // TODO
          logQueries:
            options.log &&
            Boolean(
              typeof options.log === 'string'
                ? options.log === 'query'
                : options.log.find((o) => (typeof o === 'string' ? o === 'query' : o.level === 'query')),
            ),
          compilerWasm: config.compilerWasm,
          clientVersion: config.clientVersion,
          previewFeatures: this._previewFeatures,
          activeProvider: config.activeProvider,
          inlineSchema: config.inlineSchema,
          tracingHelper: this._tracingHelper,
          transactionOptions: {
            maxWait: options.transactionOptions?.maxWait ?? 2000,
            timeout: options.transactionOptions?.timeout ?? 5000,
            isolationLevel: options.transactionOptions?.isolationLevel,
          },
          logEmitter,
          adapter,
          accelerateUrl: options.accelerateUrl,
          sqlCommenters: options.comments,
          parameterizationSchema: config.parameterizationSchema,
          runtimeDataModel: config.runtimeDataModel,
          queryPlanCacheMaxSize: optionsArg.queryPlanCacheMaxSize,
        }

        // Used in <https://github.com/prisma/prisma-extension-accelerate/blob/b6ffa853f038780f5ab2fc01bff584ca251f645b/src/extension.ts#L514>
        this._accelerateEngineConfig = Object.create(this._engineConfig)
        this._accelerateEngineConfig.accelerateUtils = {
          resolveDatasourceUrl: () => {
            if (options.accelerateUrl) {
              return options.accelerateUrl
            }
            throw new PrismaClientInitializationError(
              `\
\`accelerateUrl\` is required when using \`@prisma/extension-accelerate\`:

new PrismaClient({
  accelerateUrl: "prisma://...",
}).$extends(withAccelerate())
`,
              config.clientVersion,
            )
          },
        }

        debug('clientVersion', config.clientVersion)

        this._engine = getEngineInstance(this._engineConfig)
        this._requestHandler = new RequestHandler(this, logEmitter)

        if (options.log) {
          for (const log of options.log) {
            const level = typeof log === 'string' ? log : log.emit === 'stdout' ? log.level : null
            if (level) {
              this.$on(level, (event) => {
                logger.log(`${logger.tags[level] ?? ''}`, (event as LogEvent).message || (event as QueryEvent).query)
              })
            }
          }
        }
      } catch (e: any) {
        e.clientVersion = this._clientVersion
        throw e
      }

      // the first client has no parent so it is its own parent client
      // this is used for extensions to reference their parent client
      return (this._appliedParent = applyModelsAndClientExtensions(this))
      // this applied client is also a custom constructor return value
    }

    get [Symbol.toStringTag]() {
      return 'PrismaClient'
    }

    $on<E extends ExtendedEventType>(eventType: E, callback: EventCallback<E>): PrismaClient {
      if (eventType === 'beforeExit') {
        this._engine.onBeforeExit(callback as EventCallback<'beforeExit'>)
      } else if (eventType) {
        this._engineConfig.logEmitter.on(eventType, callback as EventCallback<LogLevel>)
      }
      return this
    }

    $connect() {
      try {
        return this._engine.start()
      } catch (e: any) {
        e.clientVersion = this._clientVersion
        throw e
      }
    }

    /**
     * Disconnect from the database
     */
    async $disconnect() {
      try {
        await this._engine.stop()
      } catch (e: any) {
        e.clientVersion = this._clientVersion
        throw e
      } finally {
        // Debug module keeps a list of last 100 logs regardless of environment
        // variables. This can cause a memory leak. It's especially bad in jest
        // environment where keeping an error in this list prevents jest sandbox
        // from being GCed. Clearing logs on disconnect helps to avoid that
        clearLogs()
      }
    }

    /**
     * Executes a raw query and always returns a number
     */
    $executeRawInternal(
      transaction: PrismaPromiseTransaction | undefined,
      clientMethod: string,
      args: RawQueryArgs,
      middlewareArgsMapper?: MiddlewareArgsMapper<unknown, unknown>,
    ): Promise<number> {
      const activeProvider = this._activeProvider

      return this._request({
        action: 'executeRaw',
        args,
        transaction,
        clientMethod,
        argsMapper: rawQueryArgsMapper({ clientMethod, activeProvider, clientVersion: this._clientVersion }),
        callsite: getCallSite(this._errorFormat),
        dataPath: [],
        middlewareArgsMapper,
      })
    }

    /**
     * Executes a raw query provided through a safe tag function
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $executeRaw(query: TemplateStringsArray | Sql, ...values: any[]) {
      return this._createPrismaPromise((transaction) => {
        if ((query as TemplateStringsArray).raw !== undefined || (query as Sql).sql !== undefined) {
          const [sql, argsMapper] = toSql(query, values)
          checkAlter(
            this._activeProvider,
            sql.text,
            sql.values,
            Array.isArray(query) ? 'prisma.$executeRaw`<SQL>`' : 'prisma.$executeRaw(sql`<SQL>`)',
          )
          return this.$executeRawInternal(transaction, '$executeRaw', sql, argsMapper)
        }

        throw new PrismaClientValidationError(
          `\`$executeRaw\` is a tag function, please use it like the following:
\`\`\`
const result = await prisma.$executeRaw\`UPDATE User SET cool = \${true} WHERE email = \${'user@email.com'};\`
\`\`\`

Or read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#executeraw
`,
          { clientVersion: this._clientVersion },
        )
      })
    }

    /**
     * Unsafe counterpart of `$executeRaw` that is susceptible to SQL injections
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $executeRawUnsafe(query: string, ...values: RawValue[]) {
      return this._createPrismaPromise((transaction) => {
        checkAlter(this._activeProvider, query, values, 'prisma.$executeRawUnsafe(<SQL>, [...values])')
        return this.$executeRawInternal(transaction, '$executeRawUnsafe', [query, ...values])
      })
    }

    /**
     * Executes a raw command only for MongoDB
     *
     * @param command
     * @returns
     */
    $runCommandRaw(command: Record<string, JsInputValue>) {
      if (config.activeProvider !== 'mongodb') {
        throw new PrismaClientValidationError(
          `The ${config.activeProvider} provider does not support $runCommandRaw. Use the mongodb provider.`,
          { clientVersion: this._clientVersion },
        )
      }

      return this._createPrismaPromise((transaction) => {
        return this._request({
          args: command,
          clientMethod: '$runCommandRaw',
          dataPath: [],
          action: 'runCommandRaw',
          argsMapper: rawCommandArgsMapper,
          callsite: getCallSite(this._errorFormat),
          transaction: transaction,
        })
      })
    }

    /**
     * Executes a raw query and returns selected data
     */
    async $queryRawInternal(
      transaction: PrismaPromiseTransaction | undefined,
      clientMethod: string,
      args: RawQueryArgs,
      middlewareArgsMapper?: MiddlewareArgsMapper<unknown, unknown>,
    ) {
      const activeProvider = this._activeProvider

      return this._request({
        action: 'queryRaw',
        args,
        transaction,
        clientMethod,
        argsMapper: rawQueryArgsMapper({ clientMethod, activeProvider, clientVersion: this._clientVersion }),
        callsite: getCallSite(this._errorFormat),
        dataPath: [],
        middlewareArgsMapper,
      })
    }

    /**
     * Executes a raw query provided through a safe tag function
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $queryRaw(query: TemplateStringsArray | Sql, ...values: any[]) {
      return this._createPrismaPromise((transaction) => {
        if ((query as TemplateStringsArray).raw !== undefined || (query as Sql).sql !== undefined) {
          return this.$queryRawInternal(transaction, '$queryRaw', ...toSql(query, values))
        }

        throw new PrismaClientValidationError(
          `\`$queryRaw\` is a tag function, please use it like the following:
\`\`\`
const result = await prisma.$queryRaw\`SELECT * FROM User WHERE id = \${1} OR email = \${'user@email.com'};\`
\`\`\`

Or read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#queryraw
`,
          { clientVersion: this._clientVersion },
        )
      })
    }

    /**
     * Counterpart to $queryRaw, that returns strongly typed results
     * @param typedSql
     */
    $queryRawTyped(typedSql: UnknownTypedSql) {
      return this._createPrismaPromise((transaction) => {
        if (!this._hasPreviewFlag('typedSql')) {
          throw new PrismaClientValidationError(
            '`typedSql` preview feature must be enabled in order to access $queryRawTyped API',
            { clientVersion: this._clientVersion },
          )
        }
        return this.$queryRawInternal(transaction, '$queryRawTyped', typedSql)
      })
    }

    /**
     * Unsafe counterpart of `$queryRaw` that is susceptible to SQL injections
     * @see https://github.com/prisma/prisma/issues/7142
     *
     * @param query
     * @param values
     * @returns
     */
    $queryRawUnsafe(query: string, ...values: RawValue[]) {
      return this._createPrismaPromise((transaction) => {
        return this.$queryRawInternal(transaction, '$queryRawUnsafe', [query, ...values])
      })
    }

    /**
     * Execute a batch of requests in a transaction
     * @param requests
     * @param options
     */
    _transactionWithArray({
      promises,
      options,
    }: {
      promises: Array<PrismaPromise<any>>
      options?: BatchTransactionOptions
    }): Promise<any> {
      const id = BatchTxIdCounter.nextId()
      const lock = getLockCountPromise(promises.length)

      const requests = promises.map((request, index) => {
        if (request?.[Symbol.toStringTag] !== 'PrismaPromise') {
          throw new Error(
            `All elements of the array need to be Prisma Client promises. Hint: Please make sure you are not awaiting the Prisma client calls you intended to pass in the $transaction function.`,
          )
        }

        const isolationLevel = options?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel
        const transaction = {
          kind: 'batch',
          id,
          index,
          isolationLevel,
          maxWait: options?.maxWait ?? this._engineConfig.transactionOptions.maxWait,
          timeout: options?.timeout ?? this._engineConfig.transactionOptions.timeout,
          lock,
        } as const
        return request.requestTransaction?.(transaction) ?? request
      })

      return waitForBatch(requests)
    }

    /**
     * Perform a long-running transaction
     * @param callback
     * @param options
     * @returns
     */
    async _transactionWithCallback({
      callback,
      options = {},
    }: {
      callback: (client: Client) => Promise<unknown>
      options?: Options
    }) {
      const itxContext = getItxScopeContext(this)
      const isNested = itxContext.kind === 'nested'
      const scopeState: ItxScopeState = isNested ? itxContext.scopeState : { stack: [] }
      const scopeStack = scopeState.stack

      const scopeId = createItxScopeId()

      if (isNested) {
        // Only the currently-active (innermost) scope can start another nested scope.
        // This prevents sibling nested transactions from running concurrently.
        const activeScope = scopeStack.at(-1)
        if (activeScope !== itxContext.scopeId) {
          throw new Error('Concurrent nested transactions are not supported')
        }
      }
      scopeStack.push(scopeId)

      const headers = { traceparent: this._tracingHelper.getTraceParent() }

      const optionsWithDefaults: Options = {
        maxWait: options?.maxWait ?? this._engineConfig.transactionOptions.maxWait,
        timeout: options?.timeout ?? this._engineConfig.transactionOptions.timeout,
        isolationLevel: options?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel,
        // Re-use the underlying transaction in the engine by reusing the same transaction id.
        newTxId: isNested ? itxContext.txId : undefined,
      }
      let info: Transaction.InteractiveTransactionInfo<unknown>
      try {
        info = await this._engine.transaction('start', headers, optionsWithDefaults)
      } catch (e) {
        // Ensure we don't leave the scope stack dirty if starting the transaction fails.
        if (scopeStack.at(-1) === scopeId) scopeStack.pop()
        throw e
      }

      let result: unknown
      try {
        // execute user logic with a proxied the client
        const transaction = { kind: 'itx', ...info } as const

        result = await callback(this._createItxClient(transaction, scopeId, scopeState))

        if (isNested) {
          // Don't allow closing a transaction if we are not the active scope.
          if (scopeStack.at(-1) !== scopeId) {
            throw new Error('Nested transactions must be closed in reverse order of creation.')
          }
        } else if (scopeStack.length !== 1) {
          throw new Error('Cannot close transaction while a nested transaction is still active.')
        }

        await this._engine.transaction('commit', headers, info)
      } catch (e: any) {
        // If we try to close out-of-order (e.g. un-awaited nested transaction),
        // the TransactionManager depth will be > 1 and a single rollback would
        // only roll back to the latest savepoint, leaving the top-level transaction
        // open and leaking it. Force rollback to depth 0 in that case.
        const isOrderViolation = scopeStack.at(-1) !== scopeId
        const rollbackScopeCount = isOrderViolation ? Math.max(1, scopeStack.length) : 1
        for (let i = 0; i < rollbackScopeCount; i++) {
          await this._engine.transaction('rollback', headers, info).catch((rollbackError) => {
            debug('rollback attempt %d/%d failed: %O', i + 1, rollbackScopeCount, rollbackError)
          })
        }

        throw e // silent rollback, throw original error
      } finally {
        if (scopeStack.at(-1) === scopeId) {
          scopeStack.pop()
        } else {
          // Reset the scope stack to avoid poisoning this transaction context after an ordering violation.
          scopeStack.length = 0
        }
      }

      return result
    }

    _createItxClient(
      transaction: PrismaPromiseInteractiveTransaction,
      scopeId: string,
      scopeState: ItxScopeState,
    ): Client {
      const itxScopeContext: NestedItxScopeContext = {
        kind: 'nested',
        txId: transaction.id,
        scopeId,
        scopeState,
      }

      return createCompositeProxy(
        applyModelsAndClientExtensions(
          createCompositeProxy(unApplyModelsAndClientExtensions(this), [
            addProperty('_appliedParent', () => this._appliedParent._createItxClient(transaction, scopeId, scopeState)),
            addProperty('_createPrismaPromise', () => createPrismaPromiseFactory(transaction)),
            addProperty(TX_SCOPE_CONTEXT, () => itxScopeContext),
          ]),
        ),
        [removeProperties(itxClientDenyList)],
      )
    }

    /**
     * Execute queries within a transaction
     * @param input a callback or a query list
     * @param options to set timeouts (callback)
     * @returns
     */
    $transaction(input: any, options?: any) {
      let callback: () => Promise<any>

      // iTx - Interactive transaction
      if (typeof input === 'function') {
        if (this._engineConfig.adapter?.adapterName === '@prisma/adapter-d1') {
          callback = () => {
            throw new Error(
              'Cloudflare D1 does not support interactive transactions. We recommend you to refactor your queries with that limitation in mind, and use batch transactions with `prisma.$transactions([])` where applicable.',
            )
          }
        } else if (config.activeProvider === 'mongodb' && getItxScopeContext(this).kind === 'nested') {
          callback = () => {
            throw new PrismaClientValidationError(
              `The ${config.activeProvider} provider does not support nested transactions`,
              { clientVersion: this._clientVersion },
            )
          }
        } else {
          callback = () => this._transactionWithCallback({ callback: input, options })
        }
      } else {
        // Batch transaction
        callback = () => this._transactionWithArray({ promises: input, options })
      }

      const spanOptions = {
        name: 'transaction',
        attributes: { method: '$transaction' },
      }

      return this._tracingHelper.runInChildSpan(spanOptions, callback)
    }

    /**
     * Runs the middlewares over params before executing a request
     * @param internalParams
     * @returns
     */
    _request(internalParams: InternalRequestParams): Promise<any> {
      // this is the otel context that is active at the callsite
      internalParams.otelParentCtx = this._tracingHelper.getActiveContext()
      const middlewareArgsMapper = internalParams.middlewareArgsMapper ?? noopMiddlewareArgsMapper

      // make sure that we don't leak extra properties to users
      const params: QueryMiddlewareParams = {
        args: middlewareArgsMapper.requestArgsToMiddlewareArgs(internalParams.args),
        dataPath: internalParams.dataPath,
        runInTransaction: Boolean(internalParams.transaction),
        action: internalParams.action,
        model: internalParams.model,
      }

      // span options for opentelemetry instrumentation
      const spanOptions = {
        operation: {
          name: 'operation',
          attributes: {
            method: params.action,
            model: params.model,
            name: params.model ? `${params.model}.${params.action}` : params.action,
          },
        } as ExtendedSpanOptions,
      }

      // prepare recursive fn that will pipe params through middlewares
      const consumer = async (changedMiddlewareParams: QueryMiddlewareParams) => {
        // we proceed with request execution
        // before we send the execution request, we use the changed params
        const { runInTransaction, args, ...changedRequestParams } = changedMiddlewareParams
        const requestParams = {
          ...internalParams,
          ...changedRequestParams,
        }

        if (args) {
          requestParams.args = middlewareArgsMapper.middlewareArgsToRequestArgs(args)
        }

        // if middleware switched off `runInTransaction`, unset `transaction`
        // property on request as well so it will be executed outside of the tx
        if (internalParams.transaction !== undefined && runInTransaction === false) {
          delete requestParams.transaction // client extensions check for this
        }

        const result = await applyQueryExtensions(this, requestParams) // also executes the query
        if (!requestParams.model) {
          return result
        }

        const extensionContext = resolveResultExtensionContext({
          dataPath: requestParams.dataPath,
          modelName: requestParams.model,
          args: requestParams.args,
          runtimeDataModel: this._runtimeDataModel,
        })

        return applyAllResultExtensions({
          result,
          modelName: extensionContext.modelName,
          args: extensionContext.args,
          extensions: this._extensions,
          runtimeDataModel: this._runtimeDataModel,
          globalOmit: this._globalOmit,
        })
      }

      return this._tracingHelper.runInChildSpan(spanOptions.operation, () => {
        if (NODE_CLIENT) {
          // https://github.com/prisma/prisma/issues/3148 not for edge client
          const asyncRes = new AsyncResource('prisma-client-request')
          return asyncRes.runInAsyncScope(() => consumer(params))
        }

        return consumer(params)
      })
    }

    async _executeRequest({
      args,
      clientMethod,
      dataPath,
      callsite,
      action,
      model,
      argsMapper,
      transaction,
      unpacker,
      otelParentCtx,
      customDataProxyFetch,
    }: InternalRequestParams) {
      try {
        // execute argument transformation before execution
        args = argsMapper ? argsMapper(args) : args

        const spanOptions: ExtendedSpanOptions = {
          name: 'serialize',
        }

        const message = this._tracingHelper.runInChildSpan(spanOptions, () =>
          serializeJsonQuery({
            modelName: model,
            runtimeDataModel: this._runtimeDataModel,
            action,
            args,
            clientMethod,
            callsite,
            extensions: this._extensions,
            errorFormat: this._errorFormat,
            clientVersion: this._clientVersion,
            previewFeatures: this._previewFeatures,
            globalOmit: this._globalOmit,
          }),
        )

        // as prettyPrintArguments takes a bit of compute
        // we only want to do it, if debug is enabled for 'prisma-client'
        if (Debug.enabled('prisma:client')) {
          debug(`Prisma Client call:`)
          debug(`prisma.${clientMethod}(${prettyPrintArguments(args)})`)
          debug(`Generated request:`)
          debug(JSON.stringify(message, null, 2) + '\n')
        }

        if (transaction?.kind === 'batch') {
          /** @see {@link getLockCountPromise} */
          await transaction.lock
        }

        return this._requestHandler.request({
          protocolQuery: message,
          modelName: model,
          action,
          clientMethod,
          dataPath,
          callsite,
          args,
          extensions: this._extensions,
          transaction,
          unpacker,
          otelParentCtx,
          otelChildCtx: this._tracingHelper.getActiveContext(),
          globalOmit: this._globalOmit,
          customDataProxyFetch,
        })
      } catch (e) {
        e.clientVersion = this._clientVersion
        throw e
      }
    }

    /**
     * Shortcut for checking a preview flag
     * @param feature preview flag
     * @returns
     */
    _hasPreviewFlag(feature: string) {
      return !!this._engineConfig.previewFeatures?.includes(feature)
    }

    $extends = $extends
  }

  return PrismaClient
}

function toSql(query: TemplateStringsArray | Sql, values: unknown[]): [Sql, MiddlewareArgsMapper<unknown, unknown>] {
  if (isTemplateStringArray(query)) {
    return [new Sql(query, values), templateStringMiddlewareArgsMapper]
  }

  return [query, sqlMiddlewareArgsMapper]
}

function isTemplateStringArray(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Array.isArray(value['raw'])
}
