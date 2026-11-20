import type { IsolationLevel } from '../engines'

export type PrismaOperationSpec<TArgs, TAction = string> = {
  args: TArgs
  action: TAction
  model: string
}

export type PrismaPromiseBatchTransaction = {
  kind: 'batch'
  id: number
  isolationLevel?: IsolationLevel
  maxWait?: number
  timeout?: number
  index: number
  lock: PromiseLike<void>
}

export type PrismaPromiseInteractiveTransaction<PayloadType = unknown> = {
  kind: 'itx'
  id: string
  payload: PayloadType
}

export type PrismaPromiseTransaction<PayloadType = unknown> =
  | PrismaPromiseBatchTransaction
  | PrismaPromiseInteractiveTransaction<PayloadType>

/**
 * Prisma's `Promise` that is backwards-compatible. All additions on top of the
 * original `Promise` are optional so that it can be backwards-compatible.
 * @see [[createPrismaPromise]]
 */
export interface PrismaPromise<TResult, TSpec extends PrismaOperationSpec<unknown> = any> extends Promise<TResult> {
  get spec(): TSpec

  /**
   * Extension of the original `.then` function
   * @param onfulfilled same as regular promises
   * @param onrejected same as regular promises
   * @param transaction transaction options
   */
  then<R1 = TResult, R2 = never>(
    onfulfilled?: (value: TResult) => R1 | PromiseLike<R1>,
    onrejected?: (error: unknown) => R2 | PromiseLike<R2>,
    transaction?: PrismaPromiseTransaction,
  ): Promise<R1 | R2>

  /**
   * Extension of the original `.catch` function
   * @param onrejected same as regular promises
   * @param transaction transaction options
   */
  catch<R = never>(
    onrejected?: ((reason: any) => R | PromiseLike<R>) | undefined | null,
    transaction?: PrismaPromiseTransaction,
  ): Promise<TResult | R>

  /**
   * Extension of the original `.finally` function
   * @param onfinally same as regular promises
   * @param transaction transaction options
   */
  finally(onfinally?: (() => void) | undefined | null, transaction?: PrismaPromiseTransaction): Promise<TResult>

  /**
   * Called when executing a batch of regular tx
   * @param transaction transaction options for batch tx
   */
  requestTransaction?(transaction: PrismaPromiseBatchTransaction): PromiseLike<unknown>
}
