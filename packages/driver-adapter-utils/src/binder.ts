import { Debug } from './debug'
import { isDriverAdapterError } from './error'
import { err, ok, Result } from './result'
import type {
  ErrorCapturingSqlDriverAdapter,
  ErrorCapturingSqlDriverAdapterFactory,
  ErrorCapturingSqlMigrationAwareDriverAdapterFactory,
  ErrorCapturingTransaction,
  ErrorRecord,
  ErrorRegistry,
  SqlDriverAdapter,
  SqlDriverAdapterFactory,
  SqlMigrationAwareDriverAdapterFactory,
  Transaction,
} from './types'

const debug = Debug('driver-adapter-utils')

class ErrorRegistryInternal implements ErrorRegistry {
  private registeredErrors: ErrorRecord[] = []

  consumeError(id: number): ErrorRecord | undefined {
    return this.registeredErrors[id]
  }

  registerNewError(error: unknown) {
    let i = 0
    while (this.registeredErrors[i] !== undefined) {
      i++
    }
    this.registeredErrors[i] = { error }
    return i
  }
}

function copySymbolsFromSource<S extends object, T extends object>(source: S, target: T) {
  const symbols = Object.getOwnPropertySymbols(source)
  const symbolObject = Object.fromEntries(symbols.map((symbol) => [symbol, true]))
  Object.assign(target, symbolObject)
}

export const bindMigrationAwareSqlAdapterFactory = (
  adapterFactory: SqlMigrationAwareDriverAdapterFactory,
): ErrorCapturingSqlMigrationAwareDriverAdapterFactory => {
  const errorRegistry = new ErrorRegistryInternal()

  const boundFactory: ErrorCapturingSqlMigrationAwareDriverAdapterFactory = {
    adapterName: adapterFactory.adapterName,
    provider: adapterFactory.provider,
    errorRegistry,
    connect: async (...args) => {
      const ctx = await wrapAsync(errorRegistry, adapterFactory.connect.bind(adapterFactory))(...args)
      return ctx.map((ctx) => bindAdapter(ctx, errorRegistry))
    },
    connectToShadowDb: async (...args) => {
      const ctx = await wrapAsync(errorRegistry, adapterFactory.connectToShadowDb.bind(adapterFactory))(...args)
      return ctx.map((ctx) => bindAdapter(ctx, errorRegistry))
    },
  }

  copySymbolsFromSource(adapterFactory, boundFactory)

  return boundFactory
}

export const bindSqlAdapterFactory = (
  adapterFactory: SqlDriverAdapterFactory,
): ErrorCapturingSqlDriverAdapterFactory => {
  const errorRegistry = new ErrorRegistryInternal()

  const boundFactory: ErrorCapturingSqlDriverAdapterFactory = {
    adapterName: adapterFactory.adapterName,
    provider: adapterFactory.provider,
    errorRegistry,
    connect: async (...args) => {
      const ctx = await wrapAsync(errorRegistry, adapterFactory.connect.bind(adapterFactory))(...args)
      return ctx.map((ctx) => bindAdapter(ctx, errorRegistry))
    },
  }

  copySymbolsFromSource(adapterFactory, boundFactory)

  return boundFactory
}

// *.bind(adapter) is required to preserve the `this` context of functions whose
// execution is delegated to napi.rs.
export const bindAdapter = (
  adapter: SqlDriverAdapter,
  errorRegistry = new ErrorRegistryInternal(),
): ErrorCapturingSqlDriverAdapter => {
  const boundAdapter: ErrorCapturingSqlDriverAdapter = {
    adapterName: adapter.adapterName,
    errorRegistry,
    queryRaw: wrapAsync(errorRegistry, adapter.queryRaw.bind(adapter)),
    executeRaw: wrapAsync(errorRegistry, adapter.executeRaw.bind(adapter)),
    executeScript: wrapAsync(errorRegistry, adapter.executeScript.bind(adapter)),
    dispose: wrapAsync(errorRegistry, adapter.dispose.bind(adapter)),
    provider: adapter.provider,
    startTransaction: async (...args) => {
      const ctx = await wrapAsync(errorRegistry, adapter.startTransaction.bind(adapter))(...args)
      return ctx.map((ctx) => bindTransaction(errorRegistry, ctx))
    },
  }

  if (adapter.getConnectionInfo) {
    boundAdapter.getConnectionInfo = wrapSync(errorRegistry, adapter.getConnectionInfo.bind(adapter))
  }

  return boundAdapter
}

// *.bind(transaction) is required to preserve the `this` context of functions whose
// execution is delegated to napi.rs.
const bindTransaction = (errorRegistry: ErrorRegistryInternal, transaction: Transaction): ErrorCapturingTransaction => {
  const boundTransaction: ErrorCapturingTransaction = {
    adapterName: transaction.adapterName,
    provider: transaction.provider,
    options: transaction.options,
    queryRaw: wrapAsync(errorRegistry, transaction.queryRaw.bind(transaction)),
    executeRaw: wrapAsync(errorRegistry, transaction.executeRaw.bind(transaction)),
    commit: wrapAsync(errorRegistry, transaction.commit.bind(transaction)),
    rollback: wrapAsync(errorRegistry, transaction.rollback.bind(transaction)),
  }

  if (transaction.createSavepoint) {
    boundTransaction.createSavepoint = wrapAsync(errorRegistry, transaction.createSavepoint.bind(transaction))
  }

  if (transaction.rollbackToSavepoint) {
    boundTransaction.rollbackToSavepoint = wrapAsync(errorRegistry, transaction.rollbackToSavepoint.bind(transaction))
  }

  if (transaction.releaseSavepoint) {
    boundTransaction.releaseSavepoint = wrapAsync(errorRegistry, transaction.releaseSavepoint.bind(transaction))
  }

  return boundTransaction
}

function wrapAsync<A extends unknown[], R>(
  registry: ErrorRegistryInternal,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<Result<R>> {
  return async (...args) => {
    try {
      return ok(await fn(...args))
    } catch (error) {
      debug('[error@wrapAsync]', error)

      // unwrap the cause of exceptions thrown by driver adapters if there is one
      if (isDriverAdapterError(error)) {
        return err(error.cause)
      }
      const id = registry.registerNewError(error)
      return err({ kind: 'GenericJs', id })
    }
  }
}

function wrapSync<A extends unknown[], R>(
  registry: ErrorRegistryInternal,
  fn: (...args: A) => R,
): (...args: A) => Result<R> {
  return (...args) => {
    try {
      return ok(fn(...args))
    } catch (error) {
      debug('[error@wrapSync]', error)

      // unwrap the cause of exceptions thrown by driver adapters if there is one
      if (isDriverAdapterError(error)) {
        return err(error.cause)
      }
      const id = registry.registerNewError(error)
      return err({ kind: 'GenericJs', id })
    }
  }
}
